import { extractWorkCssClasses } from '../editor/canvas-css';
import type { CssPieceKind } from '../editor/css-pieces';
import { cleanWorkskinCss, type CssDiagnostic } from '../targets/ao3/render/css-cleaner';
import { fixBadCharacters } from '../targets/ao3/render/fix-bad-characters';
import { sanitizeFragment, type Ao3Diagnostic } from '../targets/ao3/render/sanitize';
import { buildContentConfig } from '../targets/ao3/render/transformers';

/**
 * A single shareable custom style entry inside an `.eo3styles.json` pack.
 *
 * Designers and coders can share individual styles or full packs; writers import them into their
 * browser's style library with zero code, getting a live-rendered preview swatch, name,
 * description, and automatic Work Skin CSS injection when applied.
 */
export interface StylePackStyle {
    /** Stable slug within a pack (used to update cleanly on re-import). */
    id?: string;
    /** Display name shown in the Styles picker. */
    label: string;
    /** Short description shown below the name in the Styles picker. */
    description: string;
    /** How the style applies: inline `<span>`, block `<div>`, or HTML `template` snippet. */
    kind: CssPieceKind;
    /** Primary CSS class applied (or primary class of a template). No leading dot. */
    className: string;
    /** Additional helper classes defined in `css` (for deduplication & work-class filtering). */
    extraClasses?: string[];
    /** Short sample text displayed inside the swatch preview (and default template preview). */
    previewSample: string;
    /** AO3 Work Skin CSS (no `#workskin` prefix needed; eo3 scopes it automatically). */
    css: string;
    /** HTML snippet for `template` styles; supports `{{selection}}` and `{{selection|Default}}`. */
    templateHtml?: string;
    /** Optional custom AO3-safe HTML for the miniature swatch preview. */
    previewHtml?: string;
    /** Optional CSS overrides applied only inside the miniature swatch preview. */
    previewCss?: string;
    /** Optional creator credit for this style. */
    author?: string;
}

export interface StylePackFile {
    eo3: 'styles';
    version: 1;
    title: string;
    description?: string;
    author?: string;
    styles: StylePackStyle[];
}

export const STYLE_PACK_EXTENSION = '.eo3styles.json';

const VALID_KINDS = new Set<CssPieceKind>(['inline', 'block', 'template']);
const CSS_CLASS_RE = /^[a-zA-Z_-][a-zA-Z0-9_-]*$/;
const MAX_STYLES_PER_PACK = 200;
const MAX_CSS_LENGTH = 64 * 1024;
const MAX_HTML_LENGTH = 32 * 1024;

// Same control/non-character strip as AO3's Sanitize preprocess.
const UNSUITABLE_CHARS =
    /[\u0001-\u0008\u000b\u000e-\u001f\u007f-\u009f\ufdd0-\ufdef\ufffe\uffff\u{1fffe}\u{1ffff}\u{2fffe}\u{2ffff}\u{3fffe}\u{3ffff}\u{4fffe}\u{4ffff}\u{5fffe}\u{5ffff}\u{6fffe}\u{6ffff}\u{7fffe}\u{7ffff}\u{8fffe}\u{8ffff}\u{9fffe}\u{9ffff}\u{afffe}\u{affff}\u{bfffe}\u{bffff}\u{cfffe}\u{cffff}\u{dfffe}\u{dffff}\u{efffe}\u{effff}\u{ffffe}\u{fffff}\u{10fffe}\u{10ffff}]/gu;

export function isValidCssClassName(name: string): boolean {
    return CSS_CLASS_RE.test(name);
}

/** Converts a display label into a valid CSS class slug (e.g. "Parchment Note" → "parchment-note"). */
export function slugifyClassName(text: string): string {
    const base = text
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!base) return 'custom-style';
    return /^[0-9]/.test(base) ? `s-${base}` : base;
}

function firstClassFromHtml(html: string): string | null {
    const match = /\bclass\s*=\s*["']([^"']+)["']/i.exec(html);
    if (!match) return null;
    for (const token of match[1].trim().split(/\s+/)) {
        if (isValidCssClassName(token)) return token;
    }
    return null;
}

function cleanClassToken(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return raw.trim().replace(/^\.+/, '').trim();
}

/**
 * Validates and normalizes a single style object from a `.eo3styles.json` pack or localStorage.
 * Accepts either `label` or `name` (normalized to `label`) to be ergonomic for hand-authored packs.
 */
export function normalizeStyleEntry(raw: unknown, indexLabel = 'Style'): StylePackStyle {
    if (!raw || typeof raw !== 'object') {
        throw new Error(`${indexLabel} is not a valid object.`);
    }
    const obj = raw as Record<string, unknown>;

    const rawLabel =
        typeof obj.label === 'string' && obj.label.trim()
            ? obj.label.trim()
            : typeof obj.name === 'string' && obj.name.trim()
            ? obj.name.trim()
            : '';
    if (!rawLabel) {
        throw new Error(`${indexLabel} is missing a name.`);
    }
    const label = rawLabel.slice(0, 80);

    const kind = obj.kind as CssPieceKind;
    if (!VALID_KINDS.has(kind)) {
        throw new Error(
            `${indexLabel} (“${label}”) has an unsupported kind; expected "inline", "block", or "template".`
        );
    }

    const description =
        typeof obj.description === 'string' ? obj.description.trim().slice(0, 200) : '';

    const css = typeof obj.css === 'string' ? obj.css.trim() : '';
    if (css.length > MAX_CSS_LENGTH) {
        throw new Error(`${indexLabel} (“${label}”) CSS exceeds the 64 KiB limit.`);
    }

    const templateHtml =
        typeof obj.templateHtml === 'string' && obj.templateHtml.trim()
            ? obj.templateHtml.trim()
            : undefined;
    if (templateHtml && templateHtml.length > MAX_HTML_LENGTH) {
        throw new Error(`${indexLabel} (“${label}”) template HTML exceeds the 32 KiB limit.`);
    }
    if (kind === 'template' && !templateHtml) {
        throw new Error(`${indexLabel} (“${label}”) is a template style and needs templateHtml.`);
    }
    if (kind !== 'template' && !css) {
        throw new Error(`${indexLabel} (“${label}”) needs CSS rules.`);
    }

    let className = cleanClassToken(obj.className);
    if (!className && kind === 'template') {
        className =
            (templateHtml && firstClassFromHtml(templateHtml)) ||
            extractWorkCssClasses(css)[0] ||
            slugifyClassName(label);
    }
    if (!className || !isValidCssClassName(className)) {
        throw new Error(
            `${indexLabel} (“${label}”) needs a valid CSS class name (letters, numbers, hyphens, or underscores).`
        );
    }

    const detectedClasses = extractWorkCssClasses(css).filter((c) => c !== className);
    let extraClasses: string[] | undefined;
    if (Array.isArray(obj.extraClasses)) {
        const cleaned = obj.extraClasses
            .map(cleanClassToken)
            .filter((c) => c && c !== className && isValidCssClassName(c));
        const merged = [...new Set([...cleaned, ...detectedClasses])];
        if (merged.length) extraClasses = merged;
    } else if (detectedClasses.length) {
        extraClasses = detectedClasses;
    }

    const previewSample =
        typeof obj.previewSample === 'string' && obj.previewSample.trim()
            ? obj.previewSample.trim().slice(0, 48)
            : label.slice(0, 18);

    const previewHtml =
        typeof obj.previewHtml === 'string' && obj.previewHtml.trim()
            ? obj.previewHtml.trim().slice(0, MAX_HTML_LENGTH)
            : undefined;

    const previewCss =
        typeof obj.previewCss === 'string' && obj.previewCss.trim()
            ? obj.previewCss.trim().slice(0, MAX_CSS_LENGTH)
            : undefined;

    const author =
        typeof obj.author === 'string' && obj.author.trim()
            ? obj.author.trim().slice(0, 80)
            : undefined;

    const rawId = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : undefined;
    const id = rawId ? rawId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64) : undefined;

    return {
        ...(id ? { id } : {}),
        label,
        description,
        kind,
        className,
        ...(extraClasses ? { extraClasses } : {}),
        previewSample,
        css,
        ...(templateHtml ? { templateHtml } : {}),
        ...(previewHtml ? { previewHtml } : {}),
        ...(previewCss ? { previewCss } : {}),
        ...(author ? { author } : {}),
    };
}

/**
 * Reads an `.eo3styles.json` file (either a multi-style pack or a shorthand single-style object),
 * throwing a clear, user-facing error if anything is invalid.
 */
export function parseStylePackFile(text: string): StylePackFile {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('This isn’t a valid style pack: it couldn’t be read as JSON.');
    }
    if (!data || typeof data !== 'object') {
        throw new Error('This isn’t an eo3 style pack.');
    }
    const obj = data as Record<string, unknown>;
    if (obj.eo3 !== 'styles') {
        throw new Error('This isn’t an eo3 style pack (expected `"eo3": "styles"`).');
    }
    if (obj.version !== 1) {
        throw new Error('This style pack was made by a newer version of eo3.');
    }

    let rawStyles: unknown[];
    if (Array.isArray(obj.styles)) {
        rawStyles = obj.styles;
    } else if (typeof obj.kind === 'string') {
        // Shorthand single-style file: allow top-level style fields directly.
        rawStyles = [obj];
    } else {
        throw new Error('This style pack has no styles in it.');
    }

    if (!rawStyles.length) {
        throw new Error('This style pack has no styles in it.');
    }
    if (rawStyles.length > MAX_STYLES_PER_PACK) {
        throw new Error(`A style pack can contain at most ${MAX_STYLES_PER_PACK} styles.`);
    }

    const styles = rawStyles.map((entry, idx) => normalizeStyleEntry(entry, `Style ${idx + 1}`));
    const packAuthor =
        typeof obj.author === 'string' && obj.author.trim()
            ? obj.author.trim().slice(0, 80)
            : undefined;
    const description =
        typeof obj.description === 'string' && obj.description.trim()
            ? obj.description.trim().slice(0, 300)
            : undefined;
    const title =
        typeof obj.title === 'string' && obj.title.trim()
            ? obj.title.trim().slice(0, 100)
            : styles.length === 1
            ? styles[0].label
            : 'Style pack';

    return {
        eo3: 'styles',
        version: 1,
        title,
        ...(description ? { description } : {}),
        ...(packAuthor ? { author: packAuthor } : {}),
        styles,
    };
}

export function stringifyStylePackFile(file: StylePackFile): string {
    return JSON.stringify(file, null, 2);
}

/** A clean `.eo3styles.json` file name derived from a pack or style title. */
export function stylePackFileName(title: string): string {
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return (slug || 'styles') + STYLE_PACK_EXTENSION;
}

function formatCssDiagnostic(d: CssDiagnostic): string {
    switch (d.kind) {
        case 'no-valid-css':
            return 'CSS contains no valid rules.';
        case 'font-face':
            return '@font-face is not allowed in AO3 Work Skins.';
        case 'unsupported-at-rule':
            return `@${d.name} is not allowed in AO3 Work Skins.`;
        case 'dropped-at-rule':
            return `@${d.name} will be dropped by AO3.`;
        case 'media-flattened':
            return `@media (${d.query}) is flattened on AO3 (its rules will always apply).`;
        case 'duplicate-property':
            return `Duplicate property “${d.property}” in ${d.selectors} (AO3 keeps only the last).`;
        case 'banned-property':
            return `Property “${d.property}” is not allowed in AO3 Work Skins.`;
        case 'invalid-custom-property-name':
            return `Invalid CSS custom property “${d.property}”.`;
        case 'banned-value':
            return `Value “${d.value}” for “${d.property}” is not allowed in AO3 Work Skins.`;
        case 'no-rules-for-selectors':
            return `No allowed CSS declarations remained for ${d.selectors}.`;
        case 'work-skin-custom-property':
            return `CSS variables (${d.property}) are not allowed in AO3 Work Skins.`;
        case 'work-skin-var':
            return `var() in “${d.property}” is not allowed in AO3 Work Skins.`;
        case 'work-skin-position-fixed':
            return `position: fixed in ${d.selectors} is not allowed in AO3 Work Skins.`;
    }
}

function formatHtmlDiagnostic(d: Ao3Diagnostic): string {
    if (d.kind === 'strip-element') {
        const tag = d.node.tagName.toLowerCase();
        return d.removedContents
            ? `<${tag}> and its contents will be removed by AO3.`
            : `<${tag}> tag is not allowed on AO3 and will be unwrapped.`;
    }
    const tag = d.node.tagName.toLowerCase();
    return d.reason === 'protocol'
        ? `Unsafe URL scheme in <${tag} ${d.attr}> will be stripped by AO3.`
        : `Attribute “${d.attr}” on <${tag}> is not allowed on AO3 and will be stripped.`;
}

/**
 * Sanitizes designer-provided HTML (template or swatch preview) using AO3's strict allowlist,
 * returning both the safe HTML string and human-readable warnings for anything stripped.
 */
export function sanitizeStyleHtml(html: string): { html: string; warnings: string[] } {
    if (!html.trim()) return { html: '', warnings: [] };
    const warnings: string[] = [];
    const seen = new Set<string>();
    const onDiagnostic = (d: Ao3Diagnostic) => {
        const msg = formatHtmlDiagnostic(d);
        if (!seen.has(msg)) {
            seen.add(msg);
            warnings.push(msg);
        }
    };
    const root = document.createElement('myroot');
    root.innerHTML = fixBadCharacters(html).replace(UNSUITABLE_CHARS, '');
    sanitizeFragment(root, buildContentConfig(onDiagnostic), onDiagnostic);
    return {
        html: root.innerHTML.replace(/&nbsp;/g, '\u00a0'),
        warnings,
    };
}

export interface StyleAo3Inspection {
    cleanedCss: string;
    cssWarnings: string[];
    htmlWarnings: string[];
}

/**
 * Runs AO3's Work Skin CSS validator and HTML sanitizer over a style so importers and the
 * builder can show clear, real-time AO3 compatibility feedback.
 */
export function inspectStyleForAo3(
    style: Pick<StylePackStyle, 'css' | 'templateHtml' | 'previewHtml' | 'kind'>
): StyleAo3Inspection {
    const cssWarnings: string[] = [];
    const seenCss = new Set<string>();
    const cleanedCss = style.css.trim()
        ? cleanWorkskinCss(style.css, {
              onDiagnostic: (d) => {
                  const msg = formatCssDiagnostic(d);
                  if (!seenCss.has(msg)) {
                      seenCss.add(msg);
                      cssWarnings.push(msg);
                  }
              },
          })
        : '';

    const htmlWarnings: string[] = [];
    if (style.templateHtml?.trim()) {
        htmlWarnings.push(...sanitizeStyleHtml(style.templateHtml).warnings);
    }
    if (style.previewHtml?.trim()) {
        for (const msg of sanitizeStyleHtml(style.previewHtml).warnings) {
            if (!htmlWarnings.includes(msg)) htmlWarnings.push(msg);
        }
    }

    return { cleanedCss, cssWarnings, htmlWarnings };
}
