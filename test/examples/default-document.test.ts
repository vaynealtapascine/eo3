import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { deserializeV1 } from '../../src/storage/versions/v1';
import { cleanWorkskinCss, renderAo3Content } from '../../src/targets/ao3/render';
import { createEo3Extensions } from '../../src/editor/extensions';
import { findPieceById, hasPieceCss } from '../../src/editor/css-pieces';

describe('default introductory document (default.toml)', () => {
    const source = fs.readFileSync('assets/examples/default.toml', 'utf8');
    const doc = deserializeV1(source);
    const html = String((doc.modules[0].data as { contents?: string }).contents ?? '');
    const css = String((doc.modules[1].data as { contents?: string }).contents ?? '');

    it('uses rich-text inline editing with managed shared styles and zero AO3 diagnostics', () => {
        expect(doc.title).toBe('Welcome to eo3');
        expect(doc.modules).toHaveLength(2);
        expect(doc.modules[0].plugin.id).toBe('source.text');
        expect((doc.modules[0].data as { language?: string }).language).toBe(
            'html-contenteditable'
        );
        expect(doc.modules[1].plugin.id).toBe('source.shared-styles');
        expect(doc.sharedStylesModuleId).toBe(doc.modules[1].id);

        const diagnostics: unknown[] = [];
        const rendered = renderAo3Content(html, (d) => diagnostics.push(d));
        const cleanedCss = cleanWorkskinCss(css, {
            prefix: '#workskin',
            onDiagnostic: (d) => diagnostics.push(d),
        });

        expect(diagnostics).toEqual([]);
        expect(rendered.html).toContain('fx-translate');
        expect(rendered.html).toContain('fx-letter');
        expect(rendered.html).toContain('fx-callout');
        expect(rendered.html).toContain('fx-spoiler');
        expect(cleanedCss).toContain('#workskin .fx-translate');
        expect(cleanedCss).toContain('#workskin .fx-redacted');

        // Every showcased CSS piece is recognized by hasPieceCss so re-applying won't duplicate CSS.
        for (const id of [
            'translate',
            'redacted',
            'highlight',
            'smallcaps',
            'letter',
            'callout',
            'spoiler',
        ]) {
            const piece = findPieceById(id);
            expect(piece).toBeDefined();
            expect(hasPieceCss(css, piece!)).toBe(true);
        }
    });

    it('round-trips cleanly through TipTap without losing interactive styles or blocks', () => {
        const editor = new Editor({
            extensions: createEo3Extensions(),
            content: html,
        });

        try {
            const out = editor.getHTML();
            expect(out).toContain('class="fx-translate"');
            expect(out).toContain('class="fx-translate-tip"');
            expect(out).toContain('class="fx-translate-paren"');
            expect(out).toContain('class="fx-redacted"');
            expect(out).toContain('class="fx-highlight"');
            expect(out).toContain('class="fx-smallcaps"');
            expect(out).toContain('class="fx-letter"');
            expect(out).toContain('class="fx-callout"');
            expect(out).toContain('class="fx-spoiler"');
            expect(out).toContain('<summary>Tips for getting started</summary>');
            expect(out).not.toContain('eo3-details-toggle');
            expect(out).not.toContain('eo3-details-summary-text');
        } finally {
            editor.destroy();
        }
    });

    it('expands and collapses <details> via the non-editable chevron while keeping summary text editable', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const editor = new Editor({
            element: host,
            extensions: createEo3Extensions(),
            content: html,
        });

        try {
            const getDetails = () => host.querySelector('details.fx-spoiler') as HTMLDetailsElement;
            const getToggle = () =>
                host.querySelector(
                    'details.fx-spoiler button.eo3-details-toggle'
                ) as HTMLButtonElement;
            const getSummaryText = () =>
                host.querySelector(
                    'details.fx-spoiler .eo3-details-summary-text'
                ) as HTMLSpanElement;

            expect(getDetails()).not.toBeNull();
            expect(getToggle()).not.toBeNull();
            expect(getToggle().contentEditable).toBe('false');
            expect(getSummaryText().textContent).toBe('Tips for getting started');
            expect(getDetails().hasAttribute('open')).toBe(false);
            expect(getToggle().getAttribute('aria-expanded')).toBe('false');

            // Clicking the chevron expands the collapsible tips.
            getToggle().click();
            expect(getDetails().hasAttribute('open')).toBe(true);
            expect(getToggle().getAttribute('aria-expanded')).toBe('true');
            expect(editor.getHTML()).toContain('<details class="fx-spoiler" open="">');
            expect(editor.getHTML()).not.toContain('eo3-details-toggle');

            // Clicking the summary text does not toggle the drawer closed.
            getSummaryText().click();
            expect(getDetails().hasAttribute('open')).toBe(true);

            // Moving selection into the body and collapsing pulls selection back to the summary.
            let bodyPos = -1;
            let summaryEnd = -1;
            editor.state.doc.descendants((node, pos) => {
                if (node.type.name === 'detailsSummary') {
                    summaryEnd = pos + node.nodeSize - 1;
                }
                if (node.isText && node.text?.includes('Multi-chapter works')) {
                    bodyPos = pos + 1;
                }
            });
            expect(bodyPos).toBeGreaterThan(summaryEnd);
            editor.commands.setTextSelection(bodyPos);

            getToggle().click();
            expect(getDetails().hasAttribute('open')).toBe(false);
            expect(getToggle().getAttribute('aria-expanded')).toBe('false');
            expect(editor.state.selection.from).toBeLessThanOrEqual(summaryEnd);
            expect(editor.getHTML()).not.toContain('<details class="fx-spoiler" open="">');
        } finally {
            editor.destroy();
            host.remove();
        }
    });
});
