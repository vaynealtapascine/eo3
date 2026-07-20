import { SiteTargetExportInput, SiteTargetExportOutput, PushError } from '../types';
import { RenderConfig } from './config';
import { scanCssForWarnings } from '../scan-css';

/**
 * FNV-1a (32-bit) → base36. A cheap, synchronous, deterministic hash: the same declaration
 * block always yields the same class name across renders, chapters, and sessions, which is
 * what keeps an already-posted chapter's HTML valid against a workskin regenerated later.
 */
function hashString(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

/**
 * Normalize a `style=""` value so equivalent declaration blocks compare (and therefore
 * dedup + hash) identically regardless of declaration order, incidental whitespace, or
 * spacing around the colon. Property names are lowercased (case-insensitive in CSS); values
 * keep their case (they can be significant, e.g. url()/content strings).
 */
function normalizeDecls(style: string): string {
    return style
        .split(';')
        .map((decl) => {
            const colon = decl.indexOf(':');
            if (colon === -1) return decl.trim().replace(/\s+/g, ' ');
            const prop = decl.slice(0, colon).trim().toLowerCase();
            const value = decl.slice(colon + 1).trim().replace(/\s+/g, ' ');
            if (!prop || !value) return '';
            return `${prop}:${value}`;
        })
        .filter(Boolean)
        .sort()
        .join(';');
}

/**
 * AO3 posts carry HTML in the chapter body and CSS in a separate Work Skin. This lifts every
 * inline `style=""` from the (already AO3-rendered) HTML into scoped workskin rules:
 *
 *  - author-written classes are left untouched and their CSS is emitted verbatim, so styling
 *    shared across chapters stays globally reusable;
 *  - each distinct inline-style block becomes a rule under a deterministic, content-hashed
 *    class (`eo3-<hash>`), added alongside any existing classes; identical blocks dedup to a
 *    single shared class.
 *
 * Determinism + always emitting the full authored CSS means adding chapters later never
 * breaks the classes an already-posted chapter references. AO3 scopes workskin selectors
 * under `#workskin` on its own, so we emit plain CSS.
 */
export function exportPost(
    { html, css }: SiteTargetExportInput<RenderConfig>,
    pushError: PushError
): SiteTargetExportOutput {
    // The content renderer already warns about inline styles in the HTML; scan the authored
    // workskin CSS (which never passes through it) for the same restricted constructs.
    scanCssForWarnings(css, pushError);

    const doc = new DOMParser().parseFromString(
        ['<!doctype html><html><head></head><body>', html, '</body></html>'].join(''),
        'text/html'
    );

    const classByDecls = new Map<string, string>();
    const generatedRules: string[] = [];

    for (const node of doc.querySelectorAll('[style]')) {
        const original = (node.getAttribute('style') || '')
            .split(';')
            .map((d) => d.trim())
            .filter(Boolean)
            .join('; ');
        const normalized = normalizeDecls(node.getAttribute('style') || '');

        node.removeAttribute('style');
        if (!normalized) continue;

        let className = classByDecls.get(normalized);
        if (!className) {
            className = `eo3-${hashString(normalized)}`;
            classByDecls.set(normalized, className);
            generatedRules.push(`.${className} { ${original} }`);
        }
        node.classList.add(className);
    }

    const workskinParts: string[] = [];
    if (css.trim()) workskinParts.push(css.trim());
    if (generatedRules.length) workskinParts.push(generatedRules.join('\n'));

    return new Map([
        ['html', doc.body.innerHTML],
        ['css', workskinParts.join('\n\n')],
    ]);
}
