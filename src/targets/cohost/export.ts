import { WorkExportInput, WorkExportOutput, PushError } from '../types';
import { RenderConfig } from './config';
import { stylesToAttrs, StyleInlinerStats } from '../../plugins/transform/inline-styles-core';
import { scanCssForWarnings } from '../scan-css';
import { renderMarkdown } from './fallback-renderer';

/**
 * Cohost accepts a single HTML string per post with CSS as inline `style=""` attributes only —
 * it strips `<style>` elements and `class` attributes. So each post's rendered HTML is combined
 * with the CSS that reaches it, every rule is inlined onto the elements it matches (reusing the
 * shared style-inliner core), classes are dropped, and each post gets one HTML artifact.
 */
export function exportWork(
    { parts, workCss }: WorkExportInput<RenderConfig>,
    pushError: PushError
): WorkExportOutput {
    // The content renderer already warns about inline styles in the HTML; scan the authored
    // CSS (which never passes through it) for the same restricted constructs.
    for (const css of [workCss, ...parts.map((part) => part.css)]) {
        scanCssForWarnings(css, pushError);
    }

    const outputs = parts.map((part): [string, Map<string, string>] => {
        const html = part.html ?? renderMarkdown(part.source, () => {});
        const css = [workCss, part.css].filter(Boolean).join('\n');
        return [part.id, new Map([['html', inlineStyles(html, css, pushError)]])];
    });
    return { parts: new Map(outputs), work: new Map() };
}

function inlineStyles(html: string, css: string, pushError: PushError): string {
    const doc = new DOMParser().parseFromString(
        [
            '<!doctype html><html><head><style>',
            css,
            '</style></head><body>',
            html,
            '</body></html>',
        ].join(''),
        'text/html'
    );

    try {
        const stats: StyleInlinerStats = { mode: 'attr', inlinedToNodes: 0, styleTagBytes: 0 };
        stylesToAttrs(doc, stats);
    } catch (err) {
        // Malformed CSS (bad selector/declaration syntax, or an element's own unparseable
        // pre-existing style attribute) shouldn't blank the whole preview like a fatal error —
        // warn and fall back to unstyled-by-class-CSS output. stylesToAttrs removes <style>
        // tags from `doc` before parsing them, so nothing needs cleaning up here.
        pushError('invalid-css', { message: (err as Error)?.message ?? String(err) });
    }

    for (const node of doc.querySelectorAll('[class]')) {
        node.removeAttribute('class');
    }

    return doc.body.innerHTML;
}
