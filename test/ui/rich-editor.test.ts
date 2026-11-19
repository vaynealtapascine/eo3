import { createElement, createRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createEo3Extensions } from '../../src/editor/extensions';
import {
    editorContentToHtml,
    htmlToEditorContent,
    isEmptyEditorHtml,
} from '../../src/editor/html-sync';
import TipTapRichEditor, { RichTextEditorHandle } from '../../src/ui/components/tiptap-rich-editor';
import { SPLIT_MARKER, splitHtmlAtMarker } from '../../src/util/split-html';

vi.mock('../../src/uikit/dir-popover', () => ({
    DirPopover: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
        open ? children : null,
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
});
