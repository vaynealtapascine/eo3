// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { Document, instantiateGroupFile, ModuleGroup } from '../../src/document';
import { readSourceLines } from '../../src/editor/source-lines';
import type { GroupFile } from '../../src/storage/group-file';
import { InlineChapterEditor } from '../../src/ui/components/inline-chapter-editor';
import {
    lineContent,
    lineSourceText,
    parsePartOptions,
    updateTextModuleContents,
} from '../../src/ui/components/inline-template-helpers';
import { RenderContext } from '../../src/ui/render-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}

// jsdom has no layout; ProseMirror and the selection toolbar measure ranges.
const noRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
const noRect = () => new DOMRect(0, 0, 0, 0);
Range.prototype.getClientRects ??= noRects;
Range.prototype.getBoundingClientRect ??= noRect;

const OPTIONS = JSON.stringify([
    { value: 'mylo', label: 'MYLO' },
    { value: 'mula', label: 'MULA' },
]).replace(/"/g, '&quot;');

/**
 * Stands in for a Svelte template: one `[data-edit-line]` per `speaker:: text` paragraph. A rich
 * template passes each paragraph's HTML through instead of its text.
 */
function renderConversation(source: string, rich = false): string {
    const box = document.createElement('div');
    box.innerHTML = source;
    const paragraphs = rich
        ? Array.from(box.children).map((el) => el.innerHTML)
        : readSourceLines(source, 'html');
    const lines = paragraphs.map((line, index) => {
        const [, speaker = '', text = line] = line.match(/^(.*?)::\s?(.*)$/s) ?? [];
        const mode = rich ? ' data-edit-mode="rich"' : '';
        return (
            `<span data-edit-input="conversation" data-edit-line="${index}" data-edit-format="{speaker}:: {text}">` +
            `<span data-edit-part="speaker" data-edit-value="${speaker}" data-edit-options="${OPTIONS}">${speaker.toUpperCase()}:</span>` +
            `<span data-edit-part="text"${mode} data-edit-placeholder="Say something">${text}</span></span>`
        );
    });
    return `<div class="conversation">${lines.join('')}</div>`;
}

const SOURCE = '<p>mylo:: What the helly</p><p>mula:: whatever that means</p>';

let mounted: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
    if (mounted) {
        act(() => mounted!.root.unmount());
        mounted.container.remove();
        mounted = null;
    }
});

async function setup(initial = SOURCE, rich = false) {
    const doc = new Document();
    await doc.ensureSharedStyles();
    const file: GroupFile = {
        eo3: 'group',
        version: 1,
        title: 'Conversation',
        modules: [
            {
                plugin: 'source.text',
                title: 'conversation',
                data: { contents: initial, language: 'html-contenteditable' },
                namedSends: { '1': ['conversation'] },
            },
            {
                plugin: 'source.text',
                title: 'template output',
                data: { contents: renderConversation(initial, rich), language: 'html' },
            },
        ],
        inputs: [{ module: 0, label: '' }],
    };
    const inst = await instantiateGroupFile(file);
    const lin = doc.linear;
    if (!('layout' in lin)) throw new Error('no layout');
    doc.applyLinearLayout(
        {
            parts: {
                ...lin.layout.parts,
                [doc.parts[0].id]: [{ kind: 'block', groupId: inst.group.id }],
            },
        },
        { modules: inst.modules, groups: [inst.group as ModuleGroup] }
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted = { container, root };

    const inputId = inst.modules[0].id;
    const outputId = inst.modules[1].id;
    const source = () => String((doc.findModule(inputId)!.data as { contents: string }).contents);
    const renderNow = vi.fn();
    const draw = () =>
        act(() => {
            root.render(
                createElement(
                    RenderContext.Provider,
                    { value: { scheduleRender: () => {}, renderNow } },
                    createElement(InlineChapterEditor, {
                        document: doc,
                        partId: doc.parts[0].id,
                        renderOutput: null,
                        fallbackHtml: '',
                        panelOpen: false,
                        onTogglePanel: () => {},
                    })
                )
            );
        });
    /** What a real render does: run the "template" over the current source. */
    const rerender = () => {
        updateTextModuleContents(doc, outputId, renderConversation(source(), rich));
        draw();
    };
    draw();
    const q = <T extends Element = HTMLElement>(selector: string) =>
        Array.from(container.querySelectorAll<T & HTMLElement>(selector));
    return { doc, container, source, renderNow, rerender, q };
}

function mouseDown(el: HTMLElement) {
    act(() => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
}

function key(el: HTMLElement, name: string) {
    act(() => {
        el.dispatchEvent(
            new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
        );
    });
}

function caretAt(el: HTMLElement, offset: number) {
    const range = document.createRange();
    range.setStart(el.firstChild!, offset);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
}

describe('line-mapped templates (data-edit-line)', () => {
    it('parses part options and rebuilds a line from its format', () => {
        expect(parsePartOptions('a | b')).toEqual([
            { value: 'a', label: 'a' },
            { value: 'b', label: 'b' },
        ]);
        expect(parsePartOptions('[{"value":"x","label":"X"},"y"]')).toEqual([
            { value: 'x', label: 'X' },
            { value: 'y', label: 'y' },
        ]);
        expect(parsePartOptions('[broken')).toBeNull();
        expect(parsePartOptions('')).toBeNull();

        const host = document.createElement('div');
        host.innerHTML = renderConversation(SOURCE);
        const line = host.querySelector<HTMLElement>('[data-edit-line="1"]')!;
        expect(lineSourceText(line)).toBe('mula:: whatever that means');
        expect(lineSourceText(line, { text: 'so\nthere' })).toBe('mula:: so there');

        // A line without parts is one editable value.
        host.innerHTML = '<p data-edit-line="0">Just text</p>';
        expect(lineSourceText(host.querySelector<HTMLElement>('p')!, { text: 'New' })).toBe('New');
    });

    it('marks lines, text parts and choices, not the whole input region', async () => {
        const { q } = await setup();
        expect(q('[data-edit-line-ready]')).toHaveLength(2);
        expect(q('[data-edit-interactive="part"]').map((el) => el.textContent)).toEqual([
            'What the helly',
            'whatever that means',
        ]);
        expect(q('[data-edit-interactive="choice"]')).toHaveLength(2);
        expect(q('[data-edit-interactive="input"]')).toHaveLength(0);
    });

    it('edits a line’s text in place and writes back only that line', async () => {
        const { source, renderNow, q } = await setup();
        const text = q('[data-edit-interactive="part"]')[0];
        mouseDown(text);
        expect(text.contentEditable).toBe('true');
        act(() => {
            text.textContent = 'What the heck';
            text.dispatchEvent(new Event('input', { bubbles: true }));
            text.dispatchEvent(new FocusEvent('blur'));
        });
        expect(source()).toBe('<p>mylo:: What the heck</p><p>mula:: whatever that means</p>');
        expect(renderNow).toHaveBeenCalled();
    });

    it('changes the speaker from the line toolbar', async () => {
        const { source, q } = await setup();
        const lines = q('[data-edit-line-ready]');
        act(() => {
            lines[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        });
        const select = q<HTMLSelectElement>('.eo3-line-bar select')[0];
        expect(select.value).toBe('mula');
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['MYLO', 'MULA']);
        act(() => {
            select.value = 'mylo';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(source()).toBe('<p>mylo:: What the helly</p><p>mylo:: whatever that means</p>');
    });

    it('splits a line with Enter, continues in the new line, and removes an emptied line', async () => {
        const { source, rerender, q } = await setup();
        const text = q('[data-edit-interactive="part"]')[1];
        mouseDown(text);
        caretAt(text, 'whatever '.length);
        key(text, 'Enter');
        expect(source()).toBe(
            '<p>mylo:: What the helly</p><p>mula:: whatever</p><p>mula:: that means</p>'
        );

        rerender();
        const parts = q('[data-edit-interactive="part"]');
        expect(parts.map((el) => el.textContent)).toEqual([
            'What the helly',
            'whatever',
            'that means',
        ]);
        expect(parts[2].classList.contains('is-inline-editing')).toBe(true);

        // Add an empty line below from the toolbar; typing continues there.
        const add = q<HTMLButtonElement>('.eo3-line-bar button[aria-label="Add a line below"]')[0];
        act(() => add.click());
        expect(readSourceLines(source(), 'html')).toEqual([
            'mylo:: What the helly',
            'mula:: whatever',
            'mula:: that means',
            'mula:: ',
        ]);
        rerender();
        const empty = q('[data-edit-interactive="part"]')[3];
        expect(empty.classList.contains('is-inline-editing')).toBe(true);

        key(empty, 'Backspace');
        expect(readSourceLines(source(), 'html')).toHaveLength(3);
    });

    it('reverts every change to the source with Escape', async () => {
        const { source, q } = await setup();
        const text = q('[data-edit-interactive="part"]')[0];
        mouseDown(text);
        act(() => {
            text.textContent = 'Changed';
            text.dispatchEvent(new Event('input', { bubbles: true }));
        });
        key(text, 'Escape');
        expect(source()).toBe(SOURCE);
        expect(text.textContent).toBe('What the helly');
    });

    describe('rich parts (data-edit-mode="rich")', () => {
        const RICH =
            '<p>mylo:: What <em>the</em> helly</p><p>mula:: <span style="color: red">red</span> text</p>';

        // The rich text editor loads lazily; have its code ready so it mounts at once.
        beforeAll(async () => {
            await import('../../src/ui/components/tiptap-rich-editor');
        });

        /** Lets the lazily loaded rich text editor mount and focus. */
        async function settle() {
            for (let i = 0; i < 6; i++) {
                await act(async () => {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                });
            }
        }

        /** The TipTap editor mounted in a rich part. */
        function editorIn(part: HTMLElement): Editor {
            const dom = part.querySelector('.eo3-rich-part-host .ProseMirror') as
                | (HTMLElement & { editor?: Editor })
                | null;
            expect(dom?.editor).toBeTruthy();
            return dom!.editor!;
        }

        function clickOutside() {
            act(() => {
                document.body.dispatchEvent(
                    new MouseEvent('mousedown', { bubbles: true, cancelable: true })
                );
            });
        }

        function pressIn(editor: Editor, name: string) {
            act(() => {
                editor.view.dom.dispatchEvent(
                    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
                );
            });
        }

        it('rebuilds a line as HTML, escaping the format and plain parts', () => {
            const host = document.createElement('div');
            host.innerHTML = renderConversation(RICH, true);
            const line = host.querySelector<HTMLElement>('[data-edit-line="0"]')!;
            expect(lineContent(line)).toEqual({
                value: 'mylo:: What <em>the</em> helly',
                html: true,
            });
            expect(lineContent(line, { speaker: 'a<b' }).value).toBe(
                'a&lt;b:: What <em>the</em> helly'
            );
        });

        it('keeps inline styles the preview turns into classes when the speaker changes', async () => {
            const { source, q } = await setup(RICH, true);
            const text = q('[data-edit-interactive="part"]')[1];
            // The preview shows a generated class, not the style.
            expect(text.innerHTML).not.toContain('style=');

            const lines = q('[data-edit-line-ready]');
            act(() => {
                lines[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            });
            const select = q<HTMLSelectElement>('.eo3-line-bar select')[0];
            act(() => {
                select.value = 'mylo';
                select.dispatchEvent(new Event('change', { bubbles: true }));
            });
            expect(source()).toBe(
                '<p>mylo:: What <em>the</em> helly</p><p>mylo:: <span style="color: red">red</span> text</p>'
            );
        });

        it('edits a rich part in eo3’s rich text editor, with its selection toolbar', async () => {
            const { source, q } = await setup(RICH, true);
            const text = q('[data-edit-interactive="part"]')[0];
            mouseDown(text);
            await settle();

            expect(text.classList.contains('is-inline-rich-editing')).toBe(true);
            // Only the editor shows: the part's own contents, bare text included, are hidden.
            const visible = Array.from(text.childNodes).filter(
                (node) => !(node instanceof HTMLElement && node.hidden)
            );
            expect(visible).toEqual([text.querySelector('.eo3-rich-part-host')]);
            const editor = editorIn(text);
            // It opens on the template's HTML, formatting included.
            expect(editor.getHTML()).toContain('<em>the</em>');

            act(() => {
                editor.chain().selectAll().toggleBold().run();
            });
            clickOutside();
            expect(source()).toBe(
                '<p>mylo:: <strong>What <em>the</em> helly</strong></p><p>mula:: <span style="color: red">red</span> text</p>'
            );
            expect(text.classList.contains('is-inline-rich-editing')).toBe(false);
            // Until the next render, the part shows what was typed.
            expect(text.innerHTML).toContain('<strong>');
        });

        it('keeps a styled span through an edit', async () => {
            const { source, q } = await setup(RICH, true);
            const text = q('[data-edit-interactive="part"]')[1];
            mouseDown(text);
            await settle();
            const editor = editorIn(text);
            act(() => {
                editor.chain().focus('end').insertContent(' more').run();
            });
            clickOutside();
            expect(readSourceLines(source(), 'html')[1]).toBe('mula:: red text more');
            // The editor writes styles its own way (`color: red;`), but keeps them.
            expect(source()).toMatch(/<span style="color: red;?">red<\/span> text more/);
            expect(source()).not.toContain('eo3-');
        });

        it('splits the HTML at the caret with Enter and removes an emptied line with Backspace', async () => {
            const { source, rerender, q } = await setup(RICH, true);
            const text = q('[data-edit-interactive="part"]')[0];
            mouseDown(text);
            await settle();
            const editor = editorIn(text);
            // "What |the helly": after "What " (paragraph content starts at 1).
            act(() => {
                editor.commands.setTextSelection(1 + 'What '.length);
            });
            pressIn(editor, 'Enter');
            expect(source()).toBe(
                '<p>mylo:: What</p><p>mylo:: <em>the</em> helly</p><p>mula:: <span style="color: red">red</span> text</p>'
            );

            // The new line opens in the editor once the template renders it.
            rerender();
            await settle();
            const second = q('[data-edit-interactive="part"]')[1];
            expect(second.classList.contains('is-inline-rich-editing')).toBe(true);

            // Empty it, then Backspace removes the line.
            const secondEditor = editorIn(second);
            act(() => {
                secondEditor.commands.clearContent(true);
            });
            pressIn(secondEditor, 'Backspace');
            expect(readSourceLines(source(), 'html')).toEqual(['mylo:: What', 'mula:: red text']);
        });

        it('leaves an empty part empty (and clickable) after editing it without typing', async () => {
            const { source, q } = await setup('<p>mylo:: hi</p><p>mula:: </p>', true);
            const empty = q('[data-edit-interactive="part"]')[1];
            expect(empty.matches(':empty')).toBe(true);

            mouseDown(empty);
            await settle();
            editorIn(empty);
            clickOutside();
            await settle();
            expect(empty.matches(':empty')).toBe(true);
            expect(source()).toBe('<p>mylo:: hi</p><p>mula:: </p>');

            // It opens again on the next click.
            mouseDown(empty);
            await settle();
            expect(editorIn(empty)).toBeTruthy();
        });

        it('Escape restores the source exactly', async () => {
            const { source, q } = await setup(RICH, true);
            const text = q('[data-edit-interactive="part"]')[0];
            mouseDown(text);
            await settle();
            const editor = editorIn(text);
            act(() => {
                editor.chain().selectAll().insertContent('gone').run();
            });
            // The editor writes changes after a short pause.
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 300));
            });
            expect(source()).toContain('mylo:: gone');
            pressIn(editor, 'Escape');
            expect(source()).toBe(RICH);
            // The part shows what it did before, once.
            expect(text.querySelector('.eo3-rich-part-original')).toBeNull();
            expect(text.textContent).toBe('What the helly');
        });
    });
});
