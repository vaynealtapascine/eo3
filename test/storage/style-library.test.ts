import React from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderCustomTemplateHtml } from '../../src/editor/css-pieces';
import { createBackup, importBackup, parseBackup } from '../../src/storage/backup';
import {
    inspectStyleForAo3,
    parseStylePackFile,
    stringifyStylePackFile,
    stylePackFileName,
    type StylePackFile,
} from '../../src/storage/style-file';
import {
    buildStylePackExport,
    importStylePack,
    listCustomCssPieces,
    listLibraryStyles,
    removeLibraryStyle,
    saveLibraryStyle,
    subscribeLibraryStyles,
    updateLibraryStyle,
} from '../../src/storage/style-library';
import { MemoryStorage } from '../../src/storage';
import TiptapRichEditor from '../../src/ui/components/tiptap-rich-editor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/uikit/dir-popover', () => ({
    DirPopover: ({
        open,
        portal,
        children,
    }: {
        open: boolean;
        portal?: boolean;
        children: React.ReactNode;
    }) => {
        if (!open) return null;
        return portal ? createPortal(children, document.body) : children;
    },
}));

vi.mock('@tiptap/react/menus', () => ({
    BubbleMenu: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

describe('style-file parsing, AO3 inspection, and template rendering', () => {
    it('parses a multi-style pack, normalizes name/className, and detects extra classes', () => {
        const raw = JSON.stringify({
            eo3: 'styles',
            version: 1,
            title: 'Cozy Pack',
            author: 'DesignerX',
            description: 'Warm styles for slice-of-life fics',
            styles: [
                {
                    name: 'Tea Stain',
                    description: 'Soft warm inline accent',
                    kind: 'inline',
                    className: '.tea-stain',
                    previewSample: 'earl grey',
                    css: '.tea-stain { color: #5b3a29; background-color: #f7efe2; }',
                },
                {
                    label: 'Postcard',
                    description: 'Framed postcard snippet',
                    kind: 'template',
                    css: '.postcard { border: 1px solid #bbb; padding: 1em; } .postcard-stamp { font-weight: bold; }',
                    templateHtml:
                        '<div class="postcard"><p class="postcard-stamp">AIR MAIL</p><p class="postcard-body">{{selection|Wish you were here.}}</p></div>',
                },
            ],
        });

        const parsed = parseStylePackFile(raw);
        expect(parsed.title).toBe('Cozy Pack');
        expect(parsed.author).toBe('DesignerX');
        expect(parsed.styles).toHaveLength(2);
        expect(parsed.styles[0].label).toBe('Tea Stain');
        expect(parsed.styles[0].className).toBe('tea-stain');
        expect(parsed.styles[1].className).toBe('postcard');
        expect(parsed.styles[1].extraClasses).toEqual(['postcard-stamp']);
        expect(stylePackFileName(parsed.title)).toBe('cozy-pack.eo3styles.json');
    });

    it('accepts shorthand single-style files and rejects malformed packs with clear errors', () => {
        const single = parseStylePackFile(
            JSON.stringify({
                eo3: 'styles',
                version: 1,
                name: 'Neon',
                kind: 'inline',
                className: 'fx-neon',
                css: '.fx-neon { color: #00f5d4; }',
            })
        );
        expect(single.title).toBe('Neon');
        expect(single.styles).toHaveLength(1);

        expect(() => parseStylePackFile('{bad')).toThrow(/JSON/i);
        expect(() => parseStylePackFile(JSON.stringify({ eo3: 'group', version: 1 }))).toThrow(
            /style pack/i
        );
        expect(() =>
            parseStylePackFile(JSON.stringify({ eo3: 'styles', version: 99, styles: [] }))
        ).toThrow(/newer version/i);
        expect(() =>
            parseStylePackFile(
                JSON.stringify({
                    eo3: 'styles',
                    version: 1,
                    styles: [
                        { label: 'Broken template', kind: 'template', css: '.a { color: red; }' },
                    ],
                })
            )
        ).toThrow(/templateHtml/i);
    });

    it('reports AO3 Work Skin CSS and HTML warnings accurately', () => {
        const clean = inspectStyleForAo3({
            kind: 'inline',
            css: '.ok { color: #222; background-color: #ffe; }',
        });
        expect(clean.cssWarnings).toEqual([]);
        expect(clean.htmlWarnings).toEqual([]);

        const dirty = inspectStyleForAo3({
            kind: 'template',
            css: '.bad { color: var(--accent); position: fixed; font-weight: bold; }',
            templateHtml:
                '<div class="bad" onclick="alert(1)"><script>evil()</script><p>Safe text</p></div>',
        });
        expect(dirty.cssWarnings.some((w) => w.includes('var()'))).toBe(true);
        expect(dirty.cssWarnings.some((w) => w.includes('position: fixed'))).toBe(true);
        expect(dirty.cleanedCss).toContain('font-weight: bold');
        expect(dirty.cleanedCss).not.toContain('position: fixed');
        expect(dirty.htmlWarnings.some((w) => w.includes('<script>'))).toBe(true);
        expect(dirty.htmlWarnings.some((w) => w.includes('onclick'))).toBe(true);
    });

    it('renders custom template HTML with {{selection}}, fallbacks, multi-line splitting, and XSS sanitization', () => {
        const tpl =
            '<div class="card"><script>x()</script><p class="body">{{selection|Default line}}</p></div>';

        expect(renderCustomTemplateHtml(tpl, '')).toBe(
            '<div class="card"><p class="body">Default line</p></div>'
        );

        expect(renderCustomTemplateHtml(tpl, 'Line one\nLine <two>')).toBe(
            '<div class="card"><p class="body">Line one</p><p class="body">Line &lt;two&gt;</p></div>'
        );

        const inlineTpl = '<p class="quote">“{{selection}}”</p>';
        expect(renderCustomTemplateHtml(inlineTpl, 'First\nSecond')).toBe(
            '<p class="quote">“First<br>Second”</p>'
        );
    });
});

describe('style-library persistence, pack import/export, and backup integration', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => vi.restoreAllMocks());

    it('saves, updates, removes, imports with re-import deduplication, and exports packs', () => {
        const changed = vi.fn();
        const unsub = subscribeLibraryStyles(changed);
        try {
            const saved = saveLibraryStyle(
                {
                    label: 'Parchment',
                    description: 'Aged note',
                    kind: 'block',
                    className: 'parchment',
                    previewSample: 'Dear…',
                    css: '.parchment { background-color: #f8f1e4; }',
                },
                { pack: 'Letters', author: 'A' }
            );
            expect(listLibraryStyles()).toHaveLength(1);
            expect(changed).toHaveBeenCalledTimes(1);

            updateLibraryStyle(saved.id, {
                ...saved.style,
                label: 'Old Parchment',
            });
            expect(listCustomCssPieces()[0].label).toBe('Old Parchment');

            const pack: StylePackFile = {
                eo3: 'styles',
                version: 1,
                title: 'Sci-Fi HUD',
                author: 'Codex',
                styles: [
                    {
                        id: 'hud-alert',
                        label: 'HUD Alert',
                        description: 'Red alert strip',
                        kind: 'block',
                        className: 'hud-alert',
                        previewSample: 'ALERT',
                        css: '.hud-alert { color: #f87171; border: 1px solid #f87171; }',
                    },
                ],
            };
            const firstImport = importStylePack(pack);
            expect(firstImport.added).toBe(1);
            expect(firstImport.updated).toBe(0);

            // Re-importing the same pack updates the style in place instead of duplicating.
            const updatedPack: StylePackFile = {
                ...pack,
                styles: [{ ...pack.styles[0], description: 'Updated alert strip' }],
            };
            const secondImport = importStylePack(updatedPack);
            expect(secondImport.added).toBe(0);
            expect(secondImport.updated).toBe(1);
            expect(listLibraryStyles()).toHaveLength(2);
            expect(
                listCustomCssPieces().find((p) => p.className === 'hud-alert')?.description
            ).toBe('Updated alert strip');

            // Export round-trip
            const exported = buildStylePackExport(listLibraryStyles(), {
                title: 'Combined Pack',
                author: 'Me',
            });
            const reparsed = parseStylePackFile(stringifyStylePackFile(exported));
            expect(reparsed.styles).toHaveLength(2);

            removeLibraryStyle(saved.id);
            expect(listLibraryStyles()).toHaveLength(1);
        } finally {
            unsub();
        }
    });

    it('includes custom styles in full eo3 backups and stays backward-compatible with v1 backups without styles', async () => {
        const storage = new MemoryStorage();
        saveLibraryStyle({
            label: 'Glow',
            description: 'Soft glow',
            kind: 'inline',
            className: 'fx-glow',
            previewSample: 'glow',
            css: '.fx-glow { color: #b45309; }',
        });

        const backup = await createBackup(storage);
        expect(backup.styles).toHaveLength(1);
        const serialized = JSON.stringify(backup);

        localStorage.clear();
        expect(listLibraryStyles()).toHaveLength(0);

        await importBackup(storage, serialized);
        expect(listLibraryStyles()).toHaveLength(1);
        expect(listLibraryStyles()[0].style.className).toBe('fx-glow');

        // Older backup without `styles` field still parses and imports cleanly.
        const legacy = { ...backup };
        delete legacy.styles;
        expect(parseBackup(JSON.stringify(legacy)).styles).toBeUndefined();
    });
});

describe('custom styles UI in StylesPopover and StyleLibraryModal', () => {
    let container: HTMLDivElement;
    let root: Root;
    let origShowModal: typeof HTMLDialogElement.prototype.showModal | undefined;
    let origClose: typeof HTMLDialogElement.prototype.close | undefined;

    beforeEach(() => {
        localStorage.clear();
        // jsdom does not implement HTMLDialogElement.prototype.showModal/close natively.
        origShowModal = HTMLDialogElement.prototype.showModal;
        origClose = HTMLDialogElement.prototype.close;
        HTMLDialogElement.prototype.showModal = function () {
            this.setAttribute('open', '');
        };
        HTMLDialogElement.prototype.close = function () {
            this.removeAttribute('open');
        };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        localStorage.clear();
        if (origShowModal) HTMLDialogElement.prototype.showModal = origShowModal;
        if (origClose) HTMLDialogElement.prototype.close = origClose;
    });

    it('displays imported custom styles with live scoped swatches and applies a custom HTML template', () => {
        importStylePack({
            eo3: 'styles',
            version: 1,
            title: 'Press Pack',
            author: 'ZineMaker',
            styles: [
                {
                    id: 'headline-card',
                    label: 'Newspaper clipping',
                    description: 'Vintage newsprint article card',
                    kind: 'template',
                    className: 'news-clip',
                    previewSample: 'Extra! Extra!',
                    css: '.news-clip { background-color: #f4efe6; color: #222; border: 1px solid #999; }',
                    templateHtml:
                        '<div class="news-clip"><p class="news-body">{{selection|Breaking news!}}</p></div>',
                },
            ],
        });

        const onEnsurePieceCss = vi.fn();
        const onChange = vi.fn();
        act(() => {
            root.render(
                React.createElement(TiptapRichEditor, {
                    value: '<p>City hall mystery solved</p>',
                    onChange,
                    onEnsurePieceCss,
                })
            );
        });

        const stylesBtn = container.querySelector<HTMLButtonElement>('.i-styles-btn')!;
        act(() => {
            stylesBtn.click();
        });

        const popover = document.body.querySelector('.tiptap-styles-popover')!;
        expect(popover).not.toBeNull();
        expect(popover.textContent).toContain('Newspaper clipping');
        expect(popover.textContent).toContain('Vintage newsprint article card');
        expect(popover.textContent).toContain('Press Pack · by ZineMaker');

        // Verify live swatch renders scoped CSS & sanitized preview markup
        const liveSwatch = popover.querySelector('.i-piece-swatch.is-live');
        expect(liveSwatch).not.toBeNull();
        expect(liveSwatch?.querySelector('[data-eo3-swatch]')).not.toBeNull();
        expect(liveSwatch?.querySelector('style')?.textContent).toContain('[data-eo3-swatch=');

        // Apply the custom template piece
        const clipBtn = Array.from(
            popover.querySelectorAll<HTMLButtonElement>('.i-piece-btn')
        ).find((btn) => btn.textContent?.includes('Newspaper clipping'))!;
        act(() => {
            clipBtn.click();
        });

        expect(onEnsurePieceCss).toHaveBeenCalledTimes(1);
        expect(onEnsurePieceCss.mock.calls[0][0].className).toBe('news-clip');
        expect(onChange).toHaveBeenCalled();
        const latestHtml = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
        expect(latestHtml).toContain('news-clip');
        expect(latestHtml).toContain('Breaking news!');
    });

    it('lets a designer create a style in the builder modal and immediately use it in Styles', () => {
        act(() => {
            root.render(
                React.createElement(TiptapRichEditor, {
                    value: '<p>Hello world</p>',
                })
            );
        });

        // Open Styles popover and click "+ Create / Export"
        const stylesBtn = container.querySelector<HTMLButtonElement>('.i-styles-btn')!;
        act(() => {
            stylesBtn.click();
        });
        const createBtn = Array.from(
            document.body.querySelectorAll<HTMLButtonElement>('.i-styles-actions button')
        ).find((b) => b.textContent?.includes('Create / Export'))!;
        act(() => {
            createBtn.click();
        });

        const modal = document.body.querySelector<HTMLDialogElement>('.eo3-style-modal')!;
        expect(modal.hasAttribute('open')).toBe(true);
        expect(modal.textContent).toContain('AO3 Work Skin ready');

        // Save the default starter style ("Golden glint") to the browser library
        const saveBtn = Array.from(modal.querySelectorAll<HTMLButtonElement>('button')).find(
            (b) => b.textContent === 'Save to Styles'
        )!;
        act(() => {
            saveBtn.click();
        });

        expect(listLibraryStyles()).toHaveLength(1);
        expect(listLibraryStyles()[0].style.label).toBe('Golden glint');

        // Close modal and confirm "Golden glint" appears in ✦ Styles immediately
        const closeBtn = modal.querySelector<HTMLButtonElement>('.i-modal-close')!;
        act(() => {
            closeBtn.click();
        });
        act(() => {
            stylesBtn.click();
        });

        const popover = document.body.querySelector('.tiptap-styles-popover')!;
        expect(popover.textContent).toContain('Golden glint');
        expect(popover.textContent).toContain('Manage (1)');
    });
});
