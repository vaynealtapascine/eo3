import { SPLIT_MARKER } from '../util/split-html';

const SPLIT_COMMENT_RE = /<!--\s*eo3:split\s*-->/g;
const SPLIT_NODE_RE = /<div\b[^>]*\bdata-eo3-split(?:=""|='')?[^>]*>\s*<\/div>/gi;

/**
 * Prepares saved HTML for ProseMirror/TipTap: converts invisible `<!-- eo3:split -->` comments
 * into `<div data-eo3-split=""></div>` nodes so they render as visible, editable chapter breaks.
 */
export function htmlToEditorContent(html: string): string {
    if (!html) return '';
    return html.replace(SPLIT_COMMENT_RE, '<div data-eo3-split=""></div>');
}

/**
 * True when TipTap's serialized HTML represents an empty document (no text, no void/media nodes).
 */
export function isEmptyEditorHtml(html: string): boolean {
    const trimmed = html.trim();
    if (!trimmed) return true;
    return /^<p>(?:\s|<br\s*\/?>|<br\b[^>]*class="ProseMirror-trailingBreak"[^>]*\/?>)*<\/p>$/i.test(
        trimmed
    );
}

/**
 * Converts TipTap's serialized HTML back into eo3 module HTML, restoring `<!-- eo3:split -->`
 * markers and keeping empty documents as `''`.
 */
export function editorContentToHtml(html: string): string {
    if (isEmptyEditorHtml(html)) return '';
    return html
        .replace(SPLIT_NODE_RE, `\n${SPLIT_MARKER}\n`)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
