import { createElement, createRef } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor, type EditorEvents } from '@tiptap/core';
import type { PluginKey } from '@tiptap/pm/state';
import { Document, Module } from '../../src/document';
import { MODULES } from '../../src/plugins';
import { createEo3Extensions } from '../../src/editor/extensions';
import {
    editorContentToHtml,
    htmlToEditorContent,
    isEmptyEditorHtml,
} from '../../src/editor/html-sync';
import { extractWorkCssClasses, scopeCanvasCss } from '../../src/editor/canvas-css';
import {
    BUILTIN_PIECE_CLASSES,
    CSS_PIECES,
    buildSpoilerHtml,
    buildTextMessageThreadHtml,
    findPieceById,
} from '../../src/editor/css-pieces';
import { collectPartLiveCss, ensurePieceCssInDocument } from '../../src/editor/work-styles';
import { cleanWorkskinCss, type CssDiagnostic } from '../../src/targets/ao3/render/css-cleaner';
import TipTapRichEditor, { RichTextEditorHandle } from '../../src/ui/components/tiptap-rich-editor';
import { renderInlineTemplate } from '../../src/editor/inline-template';
import { InlineChapterEditor } from '../../src/ui/components/inline-chapter-editor';
import { SplitPanel } from '../../src/ui/components/split-panel';
import { SPLIT_MARKER, splitHtmlAtMarker } from '../../src/util/split-html';

const mockCapture = vi.hoisted(() => ({
    lastBubblePluginKey: null as PluginKey | string | null,
    openPopoverBiases: [] as Array<string | undefined>,
}));

vi.mock('../../src/uikit/dir-popover', () => ({
    DirPopover: ({
        open,
        portal,
        anchorBias,
        children,
    }: {
        open: boolean;
        portal?: boolean;
        anchorBias?: string;
        children: React.ReactNode;
    }) => {
        if (!open) return null;
        mockCapture.openPopoverBiases.push(anchorBias);
        return portal ? createPortal(children, document.body) : children;
    },
}));

vi.mock('@tiptap/react/menus', () => ({
    BubbleMenu: ({
        pluginKey,
        children,
    }: {
        pluginKey?: PluginKey | string;
        children?: React.ReactNode;
    }) => {
        mockCapture.lastBubblePluginKey = pluginKey ?? null;
        return children ?? null;
    },
}));

vi.mock('../../src/ui/components/code-editor', () => ({
    CodeEditor: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) =>
        createElement('textarea', {
            className: 'mock-code-editor',
            value,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
        }),
}));

function headlessEditor(html: string): Editor {
    return new Editor({
        extensions: createEo3Extensions(),
        content: htmlToEditorContent(html),
    });
}

describe('editor HTML boundary sync', () => {
    it('normalizes empty ProseMirror paragraphs back to an empty string', () => {
        expect(isEmptyEditorHtml('')).toBe(true);
        expect(isEmptyEditorHtml('<p></p>')).toBe(true);
        expect(isEmptyEditorHtml('<p><br></p>')).toBe(true);
        expect(isEmptyEditorHtml('<p><br class="ProseMirror-trailingBreak"></p>')).toBe(true);
        expect(isEmptyEditorHtml('<p>Hello</p>')).toBe(false);
        expect(editorContentToHtml('<p></p>')).toBe('');
    });

    it('round-trips chapter break markers cleanly with splitHtmlAtMarker', () => {
        const original = `<p>First half</p>\n${SPLIT_MARKER}\n<p>Second half</p>`;
        const editor = headlessEditor(original);
        try {
            expect(editor.getHTML()).toContain('data-eo3-split');
            const out = editorContentToHtml(editor.getHTML());
            expect(out).toContain(SPLIT_MARKER);
            const split = splitHtmlAtMarker(out);
            expect(split).toEqual({
                first: '<p>First half</p>',
                second: '<p>Second half</p>',
            });
        } finally {
            editor.destroy();
        }
    });

    it('inserts visible chapter breaks that serialize as <!-- eo3:split -->', () => {
        const editor = headlessEditor('<p>Before</p><p>After</p>');
        try {
            editor.commands.setTextSelection(7); // end of "Before"
            editor.commands.insertChapterBreak();
            const out = editorContentToHtml(editor.getHTML());
            expect(out).toContain(SPLIT_MARKER);
            expect(splitHtmlAtMarker(out)).not.toBeNull();
        } finally {
            editor.destroy();
        }
    });
});

describe('AO3 TipTap schema extensions', () => {
    it('round-trips <ruby> with and without <rp> fallback tags', () => {
        const withRp = headlessEditor(
            '<p><ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby></p>'
        );
        try {
            expect(editorContentToHtml(withRp.getHTML())).toBe(
                '<p><ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby></p>'
            );
        } finally {
            withRp.destroy();
        }

        const withoutRp = headlessEditor('<p><ruby>漢<rt>かん</rt></ruby></p>');
        try {
            expect(editorContentToHtml(withoutRp.getHTML())).toBe(
                '<p><ruby>漢<rt>かん</rt></ruby></p>'
            );
        } finally {
            withoutRp.destroy();
        }
    });

    it('inserts and unwraps ruby nodes via setRuby and unsetRuby commands', () => {
        const editor = headlessEditor('<p>Hello</p>');
        try {
            editor.commands.setTextSelection({ from: 1, to: 6 });
            expect(editor.commands.setRuby({ base: '漢', ruby: 'かん', useRp: true })).toBe(true);
            expect(editorContentToHtml(editor.getHTML())).toBe(
                '<p><ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby></p>'
            );

            editor.commands.setNodeSelection(1);
            expect(editor.commands.unsetRuby()).toBe(true);
            expect(editorContentToHtml(editor.getHTML())).toBe('<p>漢</p>');
        } finally {
            editor.destroy();
        }
    });

    it('round-trips translate-on-hover spans and supports set/unset commands', () => {
        const withParensHtml =
            '<p><span class="fx-translate">Je t’aime<span class="fx-translate-tip">' +
            '<span class="fx-translate-paren"> (</span>I love you<span class="fx-translate-paren">)</span>' +
            '</span></span></p>';
        const withParens = headlessEditor(withParensHtml);
        try {
            expect(editorContentToHtml(withParens.getHTML())).toBe(withParensHtml);
        } finally {
            withParens.destroy();
        }

        const withoutParensHtml =
            '<p><span class="fx-translate">Salut<span class="fx-translate-tip">Hi</span></span></p>';
        const withoutParens = headlessEditor(withoutParensHtml);
        try {
            expect(editorContentToHtml(withoutParens.getHTML())).toBe(withoutParensHtml);
        } finally {
            withoutParens.destroy();
        }

        const editor = headlessEditor('<p>Bonjour</p>');
        try {
            editor.commands.setTextSelection({ from: 1, to: 8 });
            const translate = findPieceById('translate')!;
            expect(
                editor.commands.insertInlineTemplate({
                    html: renderInlineTemplate(translate, 'Bonjour', {
                        translation: 'Hello',
                        parens: true,
                    }),
                    styleId: translate.id,
                })
            ).toBe(true);
            expect(editorContentToHtml(editor.getHTML())).toBe(
                '<p><span class="fx-translate">Bonjour<span class="fx-translate-tip">' +
                    '<span class="fx-translate-paren"> (</span>Hello<span class="fx-translate-paren">)</span>' +
                    '</span></span></p>'
            );

            editor.commands.setNodeSelection(1);
            expect(editor.commands.removeInlineTemplate()).toBe(true);
            expect(editorContentToHtml(editor.getHTML())).toBe('<p>Bonjour</p>');
        } finally {
            editor.destroy();
        }
    });

    it('preserves AO3 classes, dir, styled <div> blocks, <details>, and clean links', () => {
        const html = [
            '<div class="fx-letter" dir="rtl"><p class="salutation">Dear friend,</p></div>',
            '<details open=""><summary>Translation</summary><p>Hello <a href="https://example.com">world</a></p></details>',
        ].join('');
        const editor = headlessEditor(html);
        try {
            const out = editorContentToHtml(editor.getHTML());
            expect(out).toContain('<div class="fx-letter" dir="rtl">');
            expect(out).toContain('<p class="salutation">Dear friend,</p>');
            expect(out).toContain('<details open="">');
            expect(out).toContain('<summary>Translation</summary>');
            expect(out).toContain('<a href="https://example.com">world</a>');
            expect(out).not.toContain('target="_blank"');
            expect(out).not.toContain('noopener');
        } finally {
            editor.destroy();
        }
    });

    it('toggles block direction with setTextDirection', () => {
        const editor = headlessEditor('<p>مرحبا</p>');
        try {
            editor.commands.setTextDirection('rtl');
            expect(editorContentToHtml(editor.getHTML())).toBe('<p dir="rtl">مرحبا</p>');
            editor.commands.setTextDirection(null);
            expect(editorContentToHtml(editor.getHTML())).toBe('<p>مرحبا</p>');
        } finally {
            editor.destroy();
        }
    });
});

describe('TipTapRichEditor component sync & responsiveness', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('debounces edits and flushes cleanly on timer or explicit flush', () => {
        const onChange = vi.fn();
        const ref = createRef<RichTextEditorHandle>();

        act(() => {
            root.render(
                createElement(TipTapRichEditor, {
                    ref,
                    value: '<p>Start</p>',
                    onChange,
                })
            );
        });

        act(() => {
            ref.current!.getEditor()!.commands.insertContent(' more');
        });
        // Not emitted immediately on keystroke
        expect(onChange).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(250);
        });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toContain('more');

        // Explicit flush emits without waiting for the debounce timer
        act(() => {
            ref.current!.getEditor()!.commands.insertContent('!');
        });
        expect(onChange).toHaveBeenCalledTimes(1);
        act(() => {
            ref.current!.flush();
        });
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('syncs external value changes without firing spurious onChange calls', () => {
        const onChange = vi.fn();
        const ref = createRef<RichTextEditorHandle>();

        act(() => {
            root.render(
                createElement(TipTapRichEditor, {
                    ref,
                    value: '<p>First</p>',
                    onChange,
                })
            );
        });

        act(() => {
            root.render(
                createElement(TipTapRichEditor, {
                    ref,
                    value: '<p>Restored version</p>',
                    onChange,
                })
            );
        });

        expect(ref.current!.getContent()).toBe('<p>Restored version</p>');
        act(() => {
            vi.advanceTimersByTime(500);
        });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('flushes immediately when inserting a chapter break via the imperative handle', () => {
        const onChange = vi.fn();
        const ref = createRef<RichTextEditorHandle>();

        act(() => {
            root.render(
                createElement(TipTapRichEditor, {
                    ref,
                    value: '<p>One</p><p>Two</p>',
                    onChange,
                })
            );
        });

        act(() => {
            ref.current!.getEditor()!.commands.setTextSelection(4);
            ref.current!.insertChapterBreak();
        });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toContain(SPLIT_MARKER);
    });

    it('injects scoped live Work Skin CSS onto the canvas and toggles via the Skin button', () => {
        const ref = createRef<RichTextEditorHandle>();

        act(() => {
            root.render(
                createElement(TipTapRichEditor, {
                    ref,
                    value: '<div class="fx-callout"><p>Heads up</p></div>',
                    canvasCss: '#workskin .fx-callout { border-left: 4px solid #990000; }',
                })
            );
        });

        const canvas = container.querySelector<HTMLElement>('[data-eo3-canvas]');
        expect(canvas).not.toBeNull();
        const canvasId = canvas!.getAttribute('data-eo3-canvas')!;
        const styleEl = container.querySelector(`style[data-eo3-canvas-style="${canvasId}"]`);
        expect(styleEl).not.toBeNull();
        expect(styleEl!.textContent).toContain(`[data-eo3-canvas="${canvasId}"] .fx-callout`);
        expect(styleEl!.textContent).not.toContain('#workskin');

        const skinBtn = container.querySelector<HTMLButtonElement>(
            'button[aria-label*="Live Work Skin CSS"]'
        );
        expect(skinBtn).not.toBeNull();
        act(() => {
            skinBtn!.click();
        });
        expect(container.querySelector(`style[data-eo3-canvas-style="${canvasId}"]`)).toBeNull();
    });

    it('applies a CSS piece from the Styles popover and notifies onEnsurePieceCss', () => {
        const onChange = vi.fn();
        const onEnsurePieceCss = vi.fn();
        const ref = createRef<RichTextEditorHandle>();

        act(() => {
            root.render(
                createElement(TipTapRichEditor, {
                    ref,
                    value: '<p>Classified intel</p>',
                    onChange,
                    onEnsurePieceCss,
                })
            );
        });

        act(() => {
            ref.current!.getEditor()!.commands.setTextSelection({ from: 1, to: 11 });
        });

        const stylesBtn = container.querySelector<HTMLButtonElement>(
            'button[aria-label="CSS pieces and templates"]'
        );
        expect(stylesBtn).not.toBeNull();
        act(() => {
            stylesBtn!.click();
        });

        const redactedBtn = [
            ...document.body.querySelectorAll<HTMLButtonElement>('.i-piece-btn'),
        ].find((btn) => btn.textContent?.includes('Redacted'));
        expect(redactedBtn).toBeDefined();

        act(() => {
            redactedBtn!.click();
        });

        expect(onEnsurePieceCss).toHaveBeenCalledWith(findPieceById('redacted'));
        expect(onChange).toHaveBeenCalled();
        expect(onChange.mock.calls.at(-1)![0]).toBe(
            '<p><span class="fx-redacted">Classified</span> intel</p>'
        );
    });

    it('creates, edits, and removes a Translate on hover span via Styles and TranslatePopover', () => {
        const onChange = vi.fn();
        const onEnsurePieceCss = vi.fn();
        const ref = createRef<RichTextEditorHandle>();

        act(() => {
            root.render(
                createElement(TipTapRichEditor, {
                    ref,
                    value: '<p>Je t’aime mon ami</p>',
                    onChange,
                    onEnsurePieceCss,
                })
            );
        });

        // Select "Je t’aime"
        act(() => {
            ref.current!.getEditor()!.commands.setTextSelection({ from: 1, to: 10 });
        });

        const stylesBtn = container.querySelector<HTMLButtonElement>(
            'button[aria-label="CSS pieces and templates"]'
        )!;
        act(() => {
            stylesBtn.click();
        });

        const translateBtn = [
            ...document.body.querySelectorAll<HTMLButtonElement>('.i-piece-btn'),
        ].find((btn) => btn.textContent?.includes('Translate on hover'));
        expect(translateBtn).toBeDefined();

        // Clicking Translate on hover hands off to TranslatePopover pre-filled with selection
        act(() => {
            translateBtn!.click();
        });

        const form = document.body.querySelector<HTMLFormElement>('.tiptap-style-fields-popover');
        expect(form).not.toBeNull();
        const [origInput, transInput] = Array.from(
            form!.querySelectorAll<HTMLInputElement>('input[type="text"]')
        );
        expect(origInput.value).toBe('Je t’aime');

        const setInputVal = (input: HTMLInputElement, val: string) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
                .set!;
            setter.call(input, val);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };

        act(() => {
            setInputVal(transInput, 'I love you');
        });
        act(() => {
            form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });

        expect(onEnsurePieceCss).toHaveBeenCalledWith(findPieceById('translate'));
        expect(ref.current!.getContent()).toBe(
            '<p><span class="fx-translate">Je t’aime<span class="fx-translate-tip">' +
                '<span class="fx-translate-paren"> (</span>I love you<span class="fx-translate-paren">)</span>' +
                '</span></span> mon ami</p>'
        );

        // Select the translated node — active chip appears with Edit and Remove controls
        act(() => {
            ref.current!.getEditor()!.commands.setNodeSelection(1);
        });
        const editChipBtn = container.querySelector<HTMLButtonElement>(
            'button[aria-label="Edit Translate on hover"]'
        );
        expect(editChipBtn).not.toBeNull();

        act(() => {
            editChipBtn!.click();
        });
        const editForm = document.body.querySelector<HTMLFormElement>('.tiptap-style-fields-popover');
        expect(editForm).not.toBeNull();
        const [, editTransInput] = Array.from(
            editForm!.querySelectorAll<HTMLInputElement>('input[type="text"]')
        );
        expect(editTransInput.value).toBe('I love you');

        act(() => {
            setInputVal(editTransInput, 'I adore you');
        });
        act(() => {
            editForm!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(ref.current!.getContent()).toContain('I adore you');

        // Removing via active chip unwraps cleanly back to plain original text
        act(() => {
            ref.current!.getEditor()!.commands.setNodeSelection(1);
        });
        const removeChipBtn = container.querySelector<HTMLButtonElement>(
            'button[aria-label="Remove Translate on hover"]'
        )!;
        act(() => {
            removeChipBtn.click();
        });
        expect(ref.current!.getContent()).toBe('<p>Je t’aime mon ami</p>');
    });

    it('expands the floating format bar to 3 rows, recalculates position, and opens custom block style menu', () => {
        const onChange = vi.fn();
        const ref = createRef<RichTextEditorHandle>();

        act(() => {
            root.render(
                createElement(TipTapRichEditor, {
                    ref,
                    value: '<p>Hello world</p>',
                    onChange,
                })
            );
        });

        const editor = ref.current!.getEditor()!;
        act(() => {
            editor.commands.setTextSelection({ from: 1, to: 6 });
        });

        const bubble = container.querySelector<HTMLElement>('.tiptap-bubble-menu');
        expect(bubble).not.toBeNull();
        expect(bubble!.querySelectorAll('.i-bubble-row')).toHaveLength(1);
        expect(mockCapture.lastBubblePluginKey).toBeTruthy();

        const positionUpdateMetas: unknown[] = [];
        const onTx = ({ transaction }: EditorEvents['transaction']) => {
            if (!mockCapture.lastBubblePluginKey) return;
            const meta = transaction.getMeta(mockCapture.lastBubblePluginKey);
            if (meta !== undefined) positionUpdateMetas.push(meta);
        };
        editor.on('transaction', onTx);

        const chevron = bubble!.querySelector<HTMLButtonElement>('.i-chevron-btn');
        expect(chevron).not.toBeNull();
        expect(chevron!.getAttribute('aria-expanded')).toBe('false');

        // Expand to 3 rows — must notify BubbleMenu plugin to recalculate position
        act(() => {
            chevron!.click();
        });

        expect(chevron!.getAttribute('aria-expanded')).toBe('true');
        expect(bubble!.classList.contains('is-expanded')).toBe(true);
        expect(bubble!.querySelectorAll('.i-bubble-row')).toHaveLength(3);
        expect(positionUpdateMetas).toContain('updatePosition');

        // Verify all extra controls from rows 2 and 3 are present (including custom Text style menu button)
        const blockStyleBtn = bubble!.querySelector<HTMLButtonElement>(
            'button[aria-label="Text style"]'
        );
        expect(blockStyleBtn).not.toBeNull();
        for (const label of [
            'Subscript',
            'Superscript',
            'Text and highlight color',
            'Insert image',
            'Blockquote',
            'Bulleted list',
            'Numbered list',
            'Horizontal rule',
            'Align left',
            'Align center',
            'Align right',
            'Justify',
            'Right-to-left',
            'Undo',
            'Redo',
            'Insert chapter break',
        ]) {
            expect(
                bubble!.querySelector(`button[aria-label="${label}"]`),
                `Expected button "${label}" in expanded bubble`
            ).not.toBeNull();
        }

        // Opening custom EO3 Text style menu works
        act(() => {
            blockStyleBtn!.click();
        });
        const blockStyleMenu = document.body.querySelector('.tiptap-block-style-menu');
        expect(blockStyleMenu).not.toBeNull();
        const heading2Item = Array.from(
            blockStyleMenu!.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]')
        ).find((b) => b.textContent?.includes('Heading 2'));
        expect(heading2Item).toBeDefined();
        act(() => {
            heading2Item!.click();
        });
        expect(ref.current!.getContent()).toContain('<h2>Hello world</h2>');

        // Reset back to Paragraph via the menu
        act(() => {
            blockStyleBtn!.click();
        });
        const paragraphItem = Array.from(
            document.body.querySelectorAll<HTMLButtonElement>(
                '.tiptap-block-style-menu button[role="menuitemradio"]'
            )
        ).find((b) => b.textContent?.includes('Paragraph'));
        act(() => {
            paragraphItem!.click();
        });

        // Apply formatting from the expanded rows
        act(() => {
            editor.commands.setTextSelection({ from: 1, to: 6 });
        });
        const subscriptBtn = bubble!.querySelector<HTMLButtonElement>(
            'button[aria-label="Subscript"]'
        )!;
        const alignCenterBtn = bubble!.querySelector<HTMLButtonElement>(
            'button[aria-label="Align center"]'
        )!;
        act(() => {
            subscriptBtn.click();
            alignCenterBtn.click();
        });
        expect(ref.current!.getContent()).toContain(
            '<p style="text-align: center;"><sub>Hello</sub> world</p>'
        );

        // Opening color popover from the floating bar works
        const colorBtn = bubble!.querySelector<HTMLButtonElement>(
            'button[aria-label="Text and highlight color"]'
        )!;
        act(() => {
            colorBtn.click();
        });
        expect(document.body.querySelector('.tiptap-color-popover')).not.toBeNull();

        // Collapse back to 1 row — must also recalculate position
        positionUpdateMetas.length = 0;
        act(() => {
            chevron!.click();
        });
        expect(chevron!.getAttribute('aria-expanded')).toBe('false');
        expect(bubble!.querySelectorAll('.i-bubble-row')).toHaveLength(1);
        expect(positionUpdateMetas).toContain('updatePosition');

        editor.off('transaction', onTx);
    });
});

describe('CSS pieces, selection templates, and live canvas styling', () => {
    it('passes every built-in CSS piece through AO3 cleanWorkskinCss with zero diagnostics', () => {
        for (const piece of CSS_PIECES) {
            const diagnostics: CssDiagnostic[] = [];
            const cleaned = cleanWorkskinCss(piece.css, {
                prefix: '#workskin',
                onDiagnostic: (d) => diagnostics.push(d),
            });
            expect(diagnostics, `AO3 diagnostics for piece "${piece.id}"`).toEqual([]);
            expect(cleaned).toContain(`.${piece.className}`);
        }
    });

    it('scopes #workskin, unscoped selectors, and root resets safely to the editor canvas', () => {
        const css = [
            '#workskin { font-family: Georgia, serif; }',
            '#workskin .fx-callout, .note { color: #333; }',
            'body { background: #fff; }',
            '@keyframes fade { from { opacity: 0; } to { opacity: 1; } }',
        ].join('\n');

        const scoped = scopeCanvasCss(css, '[data-eo3-canvas="c1"]');
        expect(scoped).toContain('[data-eo3-canvas="c1"]{font-family:Georgia,serif}');
        expect(scoped).toContain('[data-eo3-canvas="c1"] .fx-callout');
        expect(scoped).toContain('[data-eo3-canvas="c1"] .note');
        expect(scoped).toContain('[data-eo3-canvas="c1"]{background:#fff}');
        expect(scoped).toContain('@keyframes fade');
        expect(scoped).not.toContain('#workskin');
        // Even partially broken CSS stays scoped and never leaks bare selectors
        const malformed = scopeCanvasCss('not { valid { css', '[data-eo3-canvas="c1"]');
        expect(malformed === '' || malformed.startsWith('[data-eo3-canvas="c1"]')).toBe(true);
    });

    it('extracts custom work classes while excluding generated eo3-* and built-in fx-* classes', () => {
        const css = `
            .fx-callout { border: 1px solid #000; }
            .eo3-abc123 { color: red; }
            #workskin .flashback p.whisper-custom { font-style: italic; }
        `;
        expect(extractWorkCssClasses(css, BUILTIN_PIECE_CLASSES)).toEqual([
            'flashback',
            'whisper-custom',
        ]);
    });

    it('round-trips <span class="..."> and supports StyledSpan / StyledBlock commands', () => {
        const editor = headlessEditor('<p><span class="fx-redacted">Secret</span> text</p>');
        try {
            expect(editorContentToHtml(editor.getHTML())).toBe(
                '<p><span class="fx-redacted">Secret</span> text</p>'
            );

            // Toggle inline span off on selection
            editor.commands.setTextSelection({ from: 1, to: 7 });
            editor.commands.toggleStyledSpan('fx-redacted');
            expect(editorContentToHtml(editor.getHTML())).toBe('<p>Secret text</p>');

            // Wrap, switch class, exit, and unwrap block (StarterKit TrailingNode adds a trailing <p>)
            editor.commands.wrapStyledBlock('fx-callout');
            expect(editorContentToHtml(editor.getHTML())).toContain(
                '<div class="fx-callout"><p>Secret text</p></div>'
            );
            editor.commands.wrapStyledBlock('fx-letter');
            expect(editorContentToHtml(editor.getHTML())).toContain(
                '<div class="fx-letter"><p>Secret text</p></div>'
            );
            expect(editor.commands.exitStyledBlock()).toBe(true);
            editor.commands.setTextSelection(2);
            editor.commands.wrapStyledBlock('fx-letter');
            expect(editorContentToHtml(editor.getHTML())).not.toContain('fx-letter');
            expect(editorContentToHtml(editor.getHTML())).toContain('<p>Secret text</p>');
        } finally {
            editor.destroy();
        }
    });

    it('builds AO3-safe text message threads and collapsible spoilers from selected text', () => {
        const twoSpeaker = buildTextMessageThreadHtml(
            'Alex: Are you up?\nSam: Unfortunately.\nAlex: Look outside.'
        );
        expect(twoSpeaker).toBe(
            '<div class="fx-chat">' +
                '<p class="fx-msg-in">Are you up?</p>' +
                '<p class="fx-msg-out">Unfortunately.</p>' +
                '<p class="fx-msg-in">Look outside.</p>' +
                '</div>'
        );

        const threeSpeaker = buildTextMessageThreadHtml('A: Hi\nB: Yo\nC: Hey');
        expect(threeSpeaker).toContain('<span class="fx-msg-sender">A</span> Hi');
        expect(threeSpeaker).toContain('<span class="fx-msg-sender">B</span> Yo');
        expect(threeSpeaker).toContain('<span class="fx-msg-sender">C</span> Hey');

        const spoiler = buildSpoilerHtml('Twist ending\nSecond line', 'Spoiler');
        // Templates go through AO3's sanitizer, which writes `open="open"` (the editor stores
        // `open=""` either way).
        expect(spoiler).toBe(
            '<details class="fx-spoiler" open="open"><summary>Spoiler</summary>' +
                '<p>Twist ending</p><p>Second line</p></details>'
        );
    });

    it('attaches piece CSS into Document shared styles once and reads it live', async () => {
        const doc = new Document();
        await doc.ensureSharedStyles();
        const callout = findPieceById('callout')!;

        expect(collectPartLiveCss(doc, null, null)).toBe('');
        expect(await ensurePieceCssInDocument(doc, null, callout)).toBe(true);

        const cssAfter = collectPartLiveCss(doc, null, null);
        expect(cssAfter).toContain('/* eo3:piece:callout */');
        expect(cssAfter).toContain('.fx-callout');

        // Second call is a no-op (deduplicated)
        expect(await ensurePieceCssInDocument(doc, null, callout)).toBe(false);
    });
});

describe('in-preview inline WYSIWYG and collapsible panel', () => {
    let container: HTMLDivElement;
    let root: Root;
    let origMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
        origMatchMedia = window.matchMedia;
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        window.matchMedia = origMatchMedia;
        vi.useRealTimers();
    });

    it('renders chrome-less inline TipTap variant and opens Format popover on demand', () => {
        const ref = createRef<RichTextEditorHandle>();
        const onChange = vi.fn();

        act(() => {
            root.render(
                createElement(TipTapRichEditor, {
                    ref,
                    variant: 'inline',
                    value: '<p>Chapter opening</p>',
                    canvasCss: '#workskin p { color: #333; }',
                    onChange,
                })
            );
        });

        // No fixed toolbar or scoped canvas <style> injected in inline mode
        expect(container.querySelector('.tiptap-rich-editor.is-inline')).not.toBeNull();
        expect(container.querySelector('.i-toolbar')).toBeNull();
        expect(container.querySelector('style[data-eo3-canvas-style]')).toBeNull();

        // Opening the format popover portals the 3-row toolbar (floating right) to document.body
        mockCapture.openPopoverBiases.length = 0;
        const anchor = document.createElement('button');
        act(() => {
            ref.current!.openFormat(anchor);
        });
        expect(mockCapture.openPopoverBiases).toContain('right');
        const formatPopover = document.body.querySelector(
            '.tiptap-format-popover .i-toolbar.is-rows'
        );
        expect(formatPopover).not.toBeNull();
        expect(formatPopover!.querySelectorAll('.i-toolbar-row')).toHaveLength(3);
        expect(container.contains(formatPopover)).toBe(false);
        const breakBtn = document.body.querySelector<HTMLButtonElement>(
            '.tiptap-format-popover button[aria-label="Insert chapter break"]'
        );
        expect(breakBtn).not.toBeNull();

        act(() => {
            ref.current!.getEditor()!.commands.setTextSelection(5);
            breakBtn!.click();
        });
        expect(onChange).toHaveBeenCalled();
        expect(onChange.mock.calls.at(-1)![0]).toContain(SPLIT_MARKER);
    });

    it('renders inline editing surface, side rail popovers, and chapter modules via InlineChapterEditor', async () => {
        const doc = new Document();
        await doc.ensureSharedStyles();
        await MODULES['source.text'].load();

        const onTogglePanel = vi.fn();
        const rerender = () => {
            act(() => {
                root.render(
                    createElement(InlineChapterEditor, {
                        document: doc,
                        partId: doc.parts[0].id,
                        renderOutput: null,
                        fallbackHtml: '',
                        panelOpen: false,
                        onTogglePanel,
                    })
                );
            });
        };
        doc.addEventListener('change', rerender);

        try {
            rerender();
            // Let lazy RichEditor chunk resolve
            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(container.querySelector('.eo3-inline-chapter.is-empty')).not.toBeNull();
            expect(container.querySelector('.eo3-side-rail')).not.toBeNull();

            // Open Work Skin CSS popover from side rail (portaled outside #workskin)
            const cssBtn = container.querySelector<HTMLButtonElement>(
                'button[aria-label="Edit Work Skin CSS"]'
            );
            expect(cssBtn).not.toBeNull();
            act(() => {
                cssBtn!.click();
            });
            const cssPopover = document.body.querySelector('.eo3-styles-quick-popover');
            expect(cssPopover).not.toBeNull();
            expect(container.contains(cssPopover)).toBe(false);

            // Clicking the panel toggle button notifies parent
            const panelBtn = container.querySelector<HTMLButtonElement>(
                'button[aria-label="Open side panel"]'
            );
            expect(panelBtn).not.toBeNull();
            act(() => {
                panelBtn!.click();
            });
            expect(onTogglePanel).toHaveBeenCalledTimes(1);

            // Adding a rich text module makes it render directly inline
            const textPlugin = await MODULES['source.text'].load();
            const textMod = new Module(textPlugin, {
                contents: '<p>Direct prose</p>',
                language: 'html-contenteditable',
            });
            textMod.sends = [doc.parts[0].outputId];
            act(() => {
                doc.insertModule(textMod);
            });

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(
                container.querySelector(`.eo3-inline-segment[data-module-id="${textMod.id}"]`)
            ).not.toBeNull();
            expect(container.textContent).toContain('Direct prose');

            // Clicking the side-rail Format button opens the portaled format popover
            const formatBtn = container.querySelector<HTMLButtonElement>(
                'button[aria-label="Text formatting toolbar"]'
            );
            expect(formatBtn).not.toBeNull();
            act(() => {
                formatBtn!.click();
            });
            expect(document.body.querySelector('.tiptap-format-popover .i-toolbar')).not.toBeNull();
        } finally {
            doc.removeEventListener('change', rerender);
        }
    });

    it('preserves the second pane instance in SplitPanel when toggling the left panel', () => {
        const refCalls: (HTMLDivElement | null)[] = [];
        const previewEl = createElement(
            'div',
            {
                ref: (el: HTMLDivElement | null) => refCalls.push(el),
                className: 'spy-pane',
            },
            'Preview'
        );

        act(() => {
            root.render(createElement(SplitPanel, null, null, previewEl));
        });
        expect(container.querySelector('.spy-pane')).not.toBeNull();
        expect(refCalls.length).toBe(1);
        expect(refCalls[0]).toBeInstanceOf(HTMLDivElement);

        // Expand left panel — previewEl must NOT unmount/remount
        act(() => {
            root.render(
                createElement(
                    SplitPanel,
                    null,
                    createElement('div', { className: 'left-pane' }, 'Left'),
                    previewEl
                )
            );
        });
        expect(container.querySelector('.left-pane')).not.toBeNull();
        expect(refCalls.filter((x) => x === null)).toEqual([]);

        // Collapse left panel again — still the exact same DOM node
        const nodeBefore = container.querySelector('.spy-pane');
        act(() => {
            root.render(createElement(SplitPanel, null, null, previewEl));
        });
        expect(container.querySelector('.left-pane')).toBeNull();
        expect(container.querySelector('.spy-pane')).toBe(nodeBefore);
    });

    it('injects live part-scoped CSS immediately for blocks and CSS pieces and opens Styles popover on + Styles', async () => {
        const { EXAMPLE_GROUPS } = await import('../../src/groups/examples');
        const { instantiateGroupFile } = await import('../../src/document');
        const doc = new Document();
        await doc.ensureSharedStyles();
        await MODULES['source.text'].load();

        const rerender = () => {
            act(() => {
                root.render(
                    createElement(InlineChapterEditor, {
                        document: doc,
                        partId: doc.parts[0].id,
                        renderOutput: null,
                        fallbackHtml: '',
                        panelOpen: false,
                        onTogglePanel: () => {},
                    })
                );
            });
        };
        doc.addEventListener('change', rerender);

        try {
            rerender();
            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            // Insert a ready-made block ("Text message thread") with renderOutput still null
            const threadFile = EXAMPLE_GROUPS.find((g) => g.title === 'Text message thread')!;
            const inst = await instantiateGroupFile(threadFile);
            act(() => {
                const lin = doc.linear;
                if ('layout' in lin) {
                    doc.applyLinearLayout(
                        {
                            parts: {
                                ...lin.layout.parts,
                                [doc.parts[0].id]: [{ kind: 'block', groupId: inst.group.id }],
                            },
                        },
                        { modules: inst.modules, groups: [inst.group] }
                    );
                }
            });

            // Both the block's HTML preview and its AO3-cleaned part-scoped CSS appear at 0ms
            expect(container.querySelector('.eo3-island-preview .fx-text-thread')).not.toBeNull();
            const liveStyle = container.querySelector('style[data-eo3-inline-live-css]');
            expect(liveStyle).not.toBeNull();
            expect(liveStyle!.textContent).toContain(
                `#workskin .eo3-part-${doc.parts[0].id} .fx-text-thread`
            );
            expect(liveStyle!.textContent).not.toMatch(/#workskin[^,{]*#workskin/);

            // Adding a `#workskin`-prefixed AO3 block also scopes cleanly inside `#workskin`
            const ao3MsgFile = EXAMPLE_GROUPS.find((g) => g.title === 'AO3 · Text messages')!;
            const ao3Inst = await instantiateGroupFile(ao3MsgFile);
            act(() => {
                const lin = doc.linear;
                if ('layout' in lin) {
                    doc.applyLinearLayout(
                        {
                            parts: {
                                ...lin.layout.parts,
                                [doc.parts[0].id]: [
                                    ...(lin.layout.parts[doc.parts[0].id] ?? []),
                                    { kind: 'block', groupId: ao3Inst.group.id },
                                ],
                            },
                        },
                        { modules: ao3Inst.modules, groups: [ao3Inst.group] }
                    );
                }
            });
            const updatedStyle =
                container.querySelector('style[data-eo3-inline-live-css]')?.textContent ?? '';
            expect(updatedStyle).toContain(`#workskin .eo3-part-${doc.parts[0].id} .fic-message`);
            expect(updatedStyle).not.toMatch(/#workskin[^,{]*#workskin/);

            // Clicking + opens compact searchable AddMenu floating right, and + → Styles opens Work Skin CSS
            const addBtn = container.querySelector<HTMLButtonElement>(
                'button[aria-label="Insert text, block, or module"]'
            );
            expect(addBtn).not.toBeNull();
            mockCapture.openPopoverBiases.length = 0;
            act(() => {
                addBtn!.click();
            });
            expect(mockCapture.openPopoverBiases).toContain('right');
            const addMenu = document.body.querySelector('.simple-add-menu.is-compact');
            expect(addMenu).not.toBeNull();
            const totalBeforeSearch = addMenu!.querySelectorAll('button.i-entry').length;
            expect(totalBeforeSearch).toBeGreaterThan(3);

            const searchInput = addMenu!.querySelector<HTMLInputElement>('.i-search input');
            expect(searchInput).not.toBeNull();
            act(() => {
                const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
                    .set!;
                setVal.call(searchInput, 'Styles');
                searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
            });
            const filteredEntries = Array.from(
                addMenu!.querySelectorAll<HTMLButtonElement>('button.i-entry')
            );
            expect(filteredEntries.length).toBeGreaterThan(0);
            expect(filteredEntries.length).toBeLessThan(totalBeforeSearch);

            const stylesMenuItem = filteredEntries.find(
                (b) => b.querySelector('.i-title')?.textContent === 'Styles'
            );
            expect(stylesMenuItem).toBeDefined();
            await act(async () => {
                stylesMenuItem!.click();
                await Promise.resolve();
                await Promise.resolve();
            });
            expect(document.body.querySelector('.eo3-styles-quick-popover')).not.toBeNull();
        } finally {
            doc.removeEventListener('change', rerender);
        }
    });
});
