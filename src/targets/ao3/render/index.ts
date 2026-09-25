/**
 * Port of AO3's (otwarchive) submission processing. AO3 does not use Markdown: a chapter's
 * HTML goes through `HtmlCleaner#sanitize_value` (strip → fix_bad_characters → ParagraphMaker
 * → Sanitize with the CSS_ALLOWED allowlist + transformers), and a Work Skin's CSS goes through
 * `CssCleaner#clean_css_code` with `WorkSkin#clean_css`'s extra checks. Both are ported here and
 * verified against the real Ruby (see the harness recipe in the project memory).
 */
import { fixBadCharacters } from './fix-bad-characters';
import { processParagraphs } from './paragraph-maker';
import { liftInlineStyles } from './lift-styles';
import { sanitizeFragment, Ao3Diagnostic, Ao3DiagnosticSink } from './sanitize';
import { buildContentConfig } from './transformers';
import { rubyStrip } from './ruby-str';

export interface Ao3RenderResult {
    /** AO3-ready HTML: paragraphs applied, inline styles lifted to `eo3-*` classes, sanitized. */
    html: string;
    /** Workskin rules for the lifted inline styles (`.eo3-<hash> { … }`), to append to the authored CSS. */
    css: string;
}

// Sanitize's `preprocess`: control characters and Unicode non-characters are deleted before parsing.
const UNSUITABLE_CHARS =
    /[\u0001-\u0008\u000b\u000e-\u001f\u007f-\u009f\ufdd0-\ufdef\ufffe\uffff\u{1fffe}\u{1ffff}\u{2fffe}\u{2ffff}\u{3fffe}\u{3ffff}\u{4fffe}\u{4ffff}\u{5fffe}\u{5ffff}\u{6fffe}\u{6ffff}\u{7fffe}\u{7ffff}\u{8fffe}\u{8ffff}\u{9fffe}\u{9ffff}\u{afffe}\u{affff}\u{bfffe}\u{bffff}\u{cfffe}\u{cffff}\u{dfffe}\u{dffff}\u{efffe}\u{effff}\u{ffffe}\u{fffff}\u{10fffe}\u{10ffff}]/gu;

/**
 * `HtmlCleaner#sanitize_value` for the `content` field, plus one eo3 addition: inline `style`
 * is lifted into `eo3-*` classes *before* sanitizing, because AO3 strips `style` but allows
 * `class`, so the styling survives as a workskin reference. The whole thing runs over one parsed
 * DOM tree; `onDiagnostic` receives every element/attribute the sanitizer drops.
 *
 * The result depends only on `content`, so the last run is cached and its diagnostics replayed:
 * the preview and the export both render the same content on every edit.
 */
export function renderAo3Content(
    content: string,
    onDiagnostic?: Ao3DiagnosticSink
): Ao3RenderResult {
    if (lastRun?.content !== content) {
        const diagnostics: Ao3Diagnostic[] = [];
        const result = runPipeline(content, (d) => diagnostics.push(d));
        lastRun = { content, result, diagnostics };
    }
    if (onDiagnostic) lastRun.diagnostics.forEach(onDiagnostic);
    return lastRun.result;
}

let lastRun: { content: string; result: Ao3RenderResult; diagnostics: Ao3Diagnostic[] } | null =
    null;

function runPipeline(content: string, onDiagnostic: Ao3DiagnosticSink): Ao3RenderResult {
    const root = document.createElement('myroot');
    root.innerHTML = fixBadCharacters(rubyStrip(content)).replace(UNSUITABLE_CHARS, '');
    processParagraphs(root);
    // AO3 serializes after ParagraphMaker and Sanitize re-parses; that round trip can restructure
    // (e.g. a <p> inside raw-text <title> becomes text), so do the same.
    root.innerHTML = root.innerHTML;
    const css = liftInlineStyles(root);
    sanitizeFragment(root, buildContentConfig(onDiagnostic), onDiagnostic);
    // sanitize_value turns &nbsp; entities into literal U+00A0, so the output equals what AO3 stores.
    return { html: root.innerHTML.replace(/&nbsp;/g, ' '), css };
}

export { cleanWorkskinCss } from './css-cleaner';
export type { CssDiagnostic } from './css-cleaner';
