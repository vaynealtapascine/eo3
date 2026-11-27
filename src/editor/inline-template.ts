import { Node } from '@tiptap/core';
import { CSS_PIECES, type CssPiece } from './css-pieces';
import { matchStyleTemplate, renderStyleTemplate, type StyleFieldValues } from './style-template';

/**
 * Inline templates: an inline style with `templateHtml` (built-in Translate on hover, or any
 * style a user makes the same way) is inserted as one atomic node holding its HTML, so nested
 * classed spans round-trip without ProseMirror flattening them into marks. The node is found
 * again on load by the style's class, and its text and fields are read back from its HTML.
 */

let userPieces: readonly CssPiece[] = [];

/** Tells the editor about the browser library's styles (called when the library changes). */
export function setInlineTemplateLibrary(pieces: readonly CssPiece[]): void {
    userPieces = pieces;
}

export function isInlineTemplatePiece(piece: CssPiece): boolean {
    return piece.kind === 'inline' && !!piece.templateHtml?.trim() && !!piece.className;
}

/** Every inline-template style the editor knows: built-ins first. */
export function inlineTemplatePieces(): CssPiece[] {
    return [...CSS_PIECES, ...userPieces].filter(isInlineTemplatePiece);
}

export function findInlineTemplatePiece(styleId: string): CssPiece | undefined {
    return inlineTemplatePieces().find((piece) => piece.id === styleId);
}

/** The inline-template style an element was made by, judged by its class. */
export function inlineTemplateForElement(element: Element): CssPiece | undefined {
    if (element.tagName !== 'SPAN') return undefined;
    const classes = (element.getAttribute('class') ?? '').trim().split(/\s+/);
    return inlineTemplatePieces().find((piece) => classes.includes(piece.className));
}

/**
 * The HTML an inline template makes for some text and field values. Its root is always a span
 * with the style's class, so the editor recognizes it again after saving.
 */
export function renderInlineTemplate(
    piece: CssPiece,
    selection: string,
    values: StyleFieldValues = {}
): string {
    const html = renderStyleTemplate(piece.templateHtml ?? '', {
        selection: selection.replace(/\s*\n\s*/g, ' '),
        fields: piece.fields,
        values,
        fallback: piece.previewSample || 'Text',
    });
    const box = document.createElement('div');
    box.innerHTML = html;
    const root = box.firstElementChild;
    const single = box.childNodes.length === 1 && root;
    if (single && root.tagName === 'SPAN' && root.classList.contains(piece.className)) return html;
    const span = document.createElement('span');
    span.className = piece.className;
    span.innerHTML = html;
    return span.outerHTML;
}

/** The text and field values an inline template's HTML was made from, if it can tell. */
export function readInlineTemplate(
    piece: CssPiece,
    html: string
): { selection: string; values: StyleFieldValues } | null {
    return matchStyleTemplate(piece.templateHtml ?? '', piece.fields ?? [], html);
}

/** The visible text of an inline template when its fields can't be read back. */
function plainText(html: string): string {
    const box = document.createElement('div');
    box.innerHTML = html;
    return box.textContent ?? '';
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        inlineTemplate: {
            /** Inserts an inline template's HTML at the selection (replacing it). */
            insertInlineTemplate: (attrs: { html: string; styleId: string }) => ReturnType;
            /** Replaces a selected inline template with its text. */
            removeInlineTemplate: () => ReturnType;
        };
    }
}

export const InlineTemplate = Node.create({
    name: 'inlineTemplate',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    priority: 1000,

    addAttributes() {
        return {
            html: { default: '', rendered: false },
            styleId: { default: '', rendered: false },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'span',
                priority: 1000,
                getAttrs: (element) => {
                    if (!(element instanceof Element)) return false;
                    const piece = inlineTemplateForElement(element);
                    if (!piece) return false;
                    return { html: element.outerHTML, styleId: piece.id };
                },
            },
        ];
    },

    renderHTML({ node }) {
        const template = document.createElement('template');
        template.innerHTML = String(node.attrs.html ?? '');
        const element = template.content.firstElementChild;
        return element ? (element as HTMLElement) : ['span', {}, ''];
    },

    addCommands() {
        return {
            insertInlineTemplate:
                (attrs) =>
                ({ commands }) => {
                    if (!attrs.html.trim()) return false;
                    return commands.insertContent({ type: this.name, attrs });
                },
            removeInlineTemplate:
                () =>
                ({ state, commands }) => {
                    const { selection } = state;
                    const node = 'node' in selection ? (selection as { node?: any }).node : null;
                    if (node?.type?.name !== this.name) return false;
                    const html = String(node.attrs.html ?? '');
                    const piece = findInlineTemplatePiece(String(node.attrs.styleId ?? ''));
                    const text =
                        (piece && readInlineTemplate(piece, html)?.selection) ?? plainText(html);
                    return commands.insertContent(text);
                },
        };
    },
});
