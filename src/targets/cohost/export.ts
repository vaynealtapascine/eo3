import { SiteTargetExportInput, SiteTargetExportOutput, PushError } from '../types';
import { RenderConfig } from './config';
import { stylesToAttrs, StyleInlinerStats } from '../../plugins/transform/inline-styles-core';
import { scanCssForWarnings } from '../scan-css';

/**
 * Cohost accepts a single HTML string with CSS as inline `style=""` attributes only — it
 * strips `<style>` elements and `class` attributes. So we combine the rendered HTML with the
 * authored CSS, inline every rule onto the elements it matches (reusing the shared
 * style-inliner core), drop classes, and emit one HTML artifact.
 */
export function exportPost(
    { html, css }: SiteTargetExportInput<RenderConfig>,
    pushError: PushError
): SiteTargetExportOutput {
    // The content renderer already warns about inline styles in the HTML; scan the authored
    // CSS (which never passes through it) for the same restricted constructs.
    scanCssForWarnings(css, pushError);

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

    return new Map([['html', doc.body.innerHTML]]);
}
