import { Extension, Mark, mergeAttributes, Node } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

export type TextDirection = 'ltr' | 'rtl' | null;

const CLASS_AND_DIR_TYPES = [
    'paragraph',
    'heading',
    'blockquote',
    'bulletList',
    'orderedList',
    'listItem',
    'horizontalRule',
    'styledBlock',
    'details',
    'textStyle',
];

const DIRECTION_TYPES = [
    'paragraph',
    'heading',
    'blockquote',
    'bulletList',
    'orderedList',
    'styledBlock',
];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        ao3Attributes: {
            /** Sets or clears `dir` (`ltr` / `rtl`) on the active block elements. */
            setTextDirection: (dir: TextDirection) => ReturnType;
        };
        styledSpan: {
            /** Applies `<span class="...">` to the current selection or stored marks. */
            setStyledSpan: (className: string) => ReturnType;
            /** Toggles `<span class="...">` (removes if same class is active, switches if different). */
            toggleStyledSpan: (className: string) => ReturnType;
            /** Removes the `<span class="...">` mark from the selection. */
            unsetStyledSpan: () => ReturnType;
        };
        styledBlock: {
            /**
             * Wraps the selection in `<div class="...">`. If already inside a styled block with the
             * same class, unwraps it; if inside one with a different class, switches its class.
             */
            wrapStyledBlock: (className: string) => ReturnType;
            /** Lifts the selection out of the enclosing `<div class="...">` container. */
            unwrapStyledBlock: () => ReturnType;
            /** Inserts a fresh paragraph right after the enclosing `<div class="...">`. */
            exitStyledBlock: () => ReturnType;
        };
        details: {
            /** Inserts a fresh paragraph right after the enclosing `<details>` container. */
            exitDetails: () => ReturnType;
            /** Toggles the `open` attribute on the enclosing `<details>` container. */
            toggleDetailsOpen: () => ReturnType;
        };
    }
}

/**
 * Preserves AO3-allowed `class` and `dir` attributes across rich-text round-trips (essential for
 * Work Skin styles, CSS pieces, and RTL/LTR writing), and exposes a direction command.
 */
export const Ao3Attributes = Extension.create({
    name: 'ao3Attributes',

    addGlobalAttributes() {
        return [
            {
                types: CLASS_AND_DIR_TYPES,
                attributes: {
                    class: {
                        default: null,
                        parseHTML: (element) => element.getAttribute('class') || null,
                        renderHTML: (attributes) =>
                            attributes.class ? { class: attributes.class } : {},
                    },
                    dir: {
                        default: null,
                        parseHTML: (element) => {
                            const dir = element.getAttribute('dir')?.toLowerCase();
                            return dir === 'ltr' || dir === 'rtl' ? dir : null;
                        },
                        renderHTML: (attributes) => (attributes.dir ? { dir: attributes.dir } : {}),
                    },
                },
            },
        ];
    },

    addCommands() {
        return {
            setTextDirection:
                (dir) =>
                ({ commands }) =>
                    DIRECTION_TYPES.some((type) => commands.updateAttributes(type, { dir })),
        };
    },
});

/**
 * Inline `<span class="...">` mark for Work Skin classes and inline CSS pieces (e.g. `.fx-redacted`,
 * `.fx-smallcaps`). Separate from TipTap's `TextStyle` (which matches `span[style]`) so classed
 * spans round-trip cleanly and compose with inline colors and formatting.
 */
export const StyledSpan = Mark.create({
    name: 'styledSpan',
    inclusive: true,

    addAttributes() {
        return {
            class: {
                default: null,
                parseHTML: (element) => element.getAttribute('class') || null,
                renderHTML: (attributes) => (attributes.class ? { class: attributes.class } : {}),
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'span[class]',
                getAttrs: (element) => {
                    if (!(element instanceof HTMLElement)) return false;
                    if (
                        element.classList.contains('fx-translate') &&
                        element.querySelector('.fx-translate-tip')
                    ) {
                        return false;
                    }
                    const cls = element.getAttribute('class')?.trim();
                    return cls ? { class: cls } : false;
                },
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes(HTMLAttributes), 0];
    },

    addCommands() {
        return {
            setStyledSpan:
                (className) =>
                ({ commands }) => {
                    const cls = className.trim();
                    if (!cls) return commands.unsetMark(this.name);
                    return commands.setMark(this.name, { class: cls });
                },
            toggleStyledSpan:
                (className) =>
                ({ editor, commands }) => {
                    const cls = className.trim();
                    if (!cls) return commands.unsetMark(this.name);
                    const current = (editor.getAttributes(this.name).class as string | null) ?? '';
                    if (editor.isActive(this.name) && current.trim() === cls) {
                        return commands.unsetMark(this.name);
                    }
                    return commands.setMark(this.name, { class: cls });
                },
            unsetStyledSpan:
                () =>
                ({ commands }) =>
                    commands.unsetMark(this.name),
        };
    },
});

/** Finds the depth of the nearest ancestor node with `nodeName`, or `-1` if none. */
function findAncestorDepth(
    $pos: { depth: number; node: (d: number) => { type: { name: string } } },
    nodeName: string
): number {
    for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).type.name === nodeName) return d;
    }
    return -1;
}

/**
 * Preserves styled or classed `<div class="..." style="...">` block containers (used by Work Skins,
 * imported AO3 chapters, and CSS-piece wrappers). Plain unstyled `<div>` elements are not matched
 * so pasted HTML normalizes cleanly into paragraphs.
 */
export const StyledBlock = Node.create({
    name: 'styledBlock',
    group: 'block',
    content: 'block+',
    defining: true,

    addAttributes() {
        return {
            style: {
                default: null,
                parseHTML: (element) => element.getAttribute('style') || null,
                renderHTML: (attributes) => (attributes.style ? { style: attributes.style } : {}),
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div',
                getAttrs: (element) => {
                    if (!(element instanceof HTMLElement)) return false;
                    if (element.hasAttribute('data-eo3-split')) return false;
                    if (
                        !element.getAttribute('class') &&
                        !element.getAttribute('style') &&
                        !element.getAttribute('dir')
                    ) {
                        return false;
                    }
                    return {};
                },
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes), 0];
    },

    addCommands() {
        return {
            wrapStyledBlock:
                (className) =>
                ({ state, commands }) => {
                    const cls = className.trim();
                    if (!cls) return commands.lift(this.name);

                    const depth = findAncestorDepth(state.selection.$from, this.name);
                    if (depth !== -1) {
                        const existing = String(
                            state.selection.$from.node(depth).attrs.class ?? ''
                        );
                        if (existing.trim() === cls) {
                            return commands.lift(this.name);
                        }
                        return commands.updateAttributes(this.name, { class: cls });
                    }
                    return commands.wrapIn(this.name, { class: cls });
                },
            unwrapStyledBlock:
                () =>
                ({ commands }) =>
                    commands.lift(this.name),
            exitStyledBlock:
                () =>
                ({ state, dispatch }) => {
                    const { $from } = state.selection;
                    const depth = findAncestorDepth($from, this.name);
                    if (depth === -1) return false;
                    const paragraph = state.schema.nodes.paragraph;
                    if (!paragraph) return false;
                    const insertPos = $from.after(depth);
                    const tr = state.tr.insert(insertPos, paragraph.create());
                    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
                    dispatch?.(tr.scrollIntoView());
                    return true;
                },
        };
    },

    addKeyboardShortcuts() {
        return {
            'Mod-Enter': () => this.editor.commands.exitStyledBlock(),
            // Pressing Enter on an empty trailing paragraph exits the styled block cleanly.
            Enter: () => {
                const { state } = this.editor;
                const { selection } = state;
                if (!selection.empty) return false;
                const { $from } = selection;
                if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) {
                    return false;
                }
                const blockDepth = findAncestorDepth($from, this.name);
                if (blockDepth === -1 || $from.depth !== blockDepth + 1) return false;
                const blockNode = $from.node(blockDepth);
                const indexInBlock = $from.index(blockDepth);
                // Only exit on the last child when there's already content above it (double-Enter).
                if (blockNode.childCount <= 1 || indexInBlock !== blockNode.childCount - 1) {
                    return false;
                }
                const paragraph = state.schema.nodes.paragraph;
                if (!paragraph) return false;

                return this.editor.commands.command(({ tr, dispatch }) => {
                    const emptyParaStart = $from.before($from.depth);
                    const emptyParaEnd = $from.after($from.depth);
                    tr.delete(emptyParaStart, emptyParaEnd);
                    const afterBlock = tr.mapping.map($from.after(blockDepth));
                    tr.insert(afterBlock, paragraph.create());
                    tr.setSelection(TextSelection.near(tr.doc.resolve(afterBlock + 1)));
                    dispatch?.(tr.scrollIntoView());
                    return true;
                });
            },
        };
    },
});

/** Preserves AO3-allowed `<details>` collapsible containers. */
export const Details = Node.create({
    name: 'details',
    group: 'block',
    content: 'detailsSummary block+',
    defining: true,

    addAttributes() {
        return {
            open: {
                default: null,
                parseHTML: (element) => (element.hasAttribute('open') ? '' : null),
                renderHTML: (attributes) => (attributes.open !== null ? { open: '' } : {}),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'details' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['details', mergeAttributes(HTMLAttributes), 0];
    },

    addCommands() {
        return {
            exitDetails:
                () =>
                ({ state, dispatch }) => {
                    const { $from } = state.selection;
                    const depth = findAncestorDepth($from, this.name);
                    if (depth === -1) return false;
                    const paragraph = state.schema.nodes.paragraph;
                    if (!paragraph) return false;
                    const insertPos = $from.after(depth);
                    const tr = state.tr.insert(insertPos, paragraph.create());
                    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
                    dispatch?.(tr.scrollIntoView());
                    return true;
                },
            toggleDetailsOpen:
                () =>
                ({ state, dispatch }) => {
                    const { $from } = state.selection;
                    const depth = findAncestorDepth($from, this.name);
                    if (depth === -1) return false;
                    const detailsPos = $from.before(depth);
                    const detailsNode = state.doc.nodeAt(detailsPos);
                    if (!detailsNode || detailsNode.type.name !== this.name) return false;
                    const isOpen = detailsNode.attrs.open !== null;
                    const tr = state.tr.setNodeMarkup(detailsPos, undefined, {
                        ...detailsNode.attrs,
                        open: isOpen ? null : '',
                    });
                    if (isOpen && detailsNode.firstChild?.type.name === 'detailsSummary') {
                        const summaryEnd = detailsPos + 1 + detailsNode.firstChild.nodeSize - 1;
                        if (state.selection.from > summaryEnd) {
                            tr.setSelection(TextSelection.near(tr.doc.resolve(summaryEnd), -1));
                        }
                    }
                    dispatch?.(tr);
                    return true;
                },
        };
    },

    addKeyboardShortcuts() {
        return {
            'Mod-Enter': () => this.editor.commands.exitDetails(),
        };
    },
});

/**
 * Heading element inside `<details>`.
 *
 * Uses a NodeView that separates a non-editable disclosure chevron button (`contenteditable="false"`)
 * from the editable summary text so clicking the chevron reliably expands/collapses `<details>`
 * while clicking the text edits the summary label directly. Exported HTML remains clean
 * `<summary>…</summary>`.
 */
export const DetailsSummary = Node.create({
    name: 'detailsSummary',
    content: 'inline*',
    defining: true,

    parseHTML() {
        return [{ tag: 'summary' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['summary', mergeAttributes(HTMLAttributes), 0];
    },

    addNodeView() {
        return ({ node, editor, getPos }) => {
            let currentNode = node;

            const dom = document.createElement('summary');
            dom.className = 'eo3-details-summary';

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'eo3-details-toggle';
            toggle.contentEditable = 'false';
            toggle.setAttribute('aria-label', 'Toggle collapsible section');
            toggle.title = 'Expand or collapse';
            toggle.innerHTML =
                '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">' +
                '<path d="M4 2.5L8.25 6L4 9.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>' +
                '</svg>';

            const contentDOM = document.createElement('span');
            contentDOM.className = 'eo3-details-summary-text';

            dom.appendChild(toggle);
            dom.appendChild(contentDOM);

            const resolveDetails = () => {
                const pos = typeof getPos === 'function' ? getPos() : undefined;
                if (typeof pos !== 'number') return null;
                try {
                    const $pos = editor.state.doc.resolve(pos);
                    const depth = findAncestorDepth($pos, 'details');
                    if (depth === -1) return null;
                    const detailsPos = $pos.before(depth);
                    const detailsNode = editor.state.doc.nodeAt(detailsPos);
                    if (!detailsNode || detailsNode.type.name !== 'details') return null;
                    return { summaryPos: pos, detailsPos, detailsNode };
                } catch {
                    return null;
                }
            };

            const syncExpanded = () => {
                const info = resolveDetails();
                const isOpen = info
                    ? info.detailsNode.attrs.open !== null
                    : !!dom.parentElement?.hasAttribute('open');
                toggle.setAttribute('aria-expanded', String(isOpen));
            };
            syncExpanded();

            const onToggleMouseDown = (event: MouseEvent) => {
                // Keep ProseMirror from moving the caret when clicking the chevron.
                event.preventDefault();
                event.stopPropagation();
            };

            const onToggleClick = (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                const info = resolveDetails();
                if (!info) return;
                const { summaryPos, detailsPos, detailsNode } = info;
                const isOpen = detailsNode.attrs.open !== null;
                const nextOpen = isOpen ? null : '';
                const tr = editor.state.tr.setNodeMarkup(detailsPos, undefined, {
                    ...detailsNode.attrs,
                    open: nextOpen,
                });
                if (isOpen) {
                    const summaryEnd = summaryPos + currentNode.nodeSize - 1;
                    const detailsEnd = detailsPos + detailsNode.nodeSize;
                    if (
                        editor.state.selection.from > summaryEnd &&
                        editor.state.selection.from < detailsEnd
                    ) {
                        tr.setSelection(TextSelection.near(tr.doc.resolve(summaryEnd), -1));
                    }
                }
                editor.view.dispatch(tr);
                toggle.setAttribute('aria-expanded', String(!isOpen));
            };

            const onSummaryClick = (event: MouseEvent) => {
                // Prevent native browser <summary> toggling when clicking the editable summary text.
                const target = event.target;
                if (!(target instanceof globalThis.Node) || !toggle.contains(target)) {
                    event.preventDefault();
                }
            };

            toggle.addEventListener('mousedown', onToggleMouseDown);
            toggle.addEventListener('click', onToggleClick);
            dom.addEventListener('click', onSummaryClick);

            return {
                dom,
                contentDOM,
                update(updatedNode) {
                    if (updatedNode.type !== currentNode.type) return false;
                    currentNode = updatedNode;
                    syncExpanded();
                    return true;
                },
                stopEvent(event) {
                    const target = event.target;
                    return target instanceof globalThis.Node && toggle.contains(target);
                },
                ignoreMutation(mutation) {
                    if (mutation.type === 'selection') return false;
                    const target = mutation.target;
                    return target instanceof globalThis.Node && toggle.contains(target);
                },
                destroy() {
                    toggle.removeEventListener('mousedown', onToggleMouseDown);
                    toggle.removeEventListener('click', onToggleClick);
                    dom.removeEventListener('click', onSummaryClick);
                },
            };
        };
    },
});
