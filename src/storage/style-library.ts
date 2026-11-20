import type { CssPiece } from '../editor/css-pieces';
import { createBrowserListStore } from './browser-list-store';
import {
    inspectStyleForAo3,
    normalizeStyleEntry,
    sanitizeStyleHtml,
    type StylePackFile,
    type StylePackStyle,
} from './style-file';

/**
 * Browser library of user-created and imported custom styles (`localStorage`), shared across all
 * works in this browser. Export as `.eo3styles.json` to share with other writers or move between
 * browsers (and included automatically in full eo3 backups).
 */
const STORAGE_KEY = 'eo3:style-library';

export interface LibraryStyle {
    id: string;
    style: StylePackStyle;
    /** Optional pack title this style was imported from or belongs to. */
    pack?: string;
    /** Optional pack-level author fallback. */
    author?: string;
}

function nextLibraryStyleId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().slice(0, 12);
    }
    return Math.random().toString(36).slice(2, 12);
}

export function parseLibraryStyle(value: unknown): LibraryStyle | null {
    if (!value || typeof value !== 'object') return null;
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !entry.id.trim()) return null;
    const style = normalizeStyleEntry(entry.style, 'Saved style');
    const pack =
        typeof entry.pack === 'string' && entry.pack.trim()
            ? entry.pack.trim().slice(0, 100)
            : undefined;
    const author =
        typeof entry.author === 'string' && entry.author.trim()
            ? entry.author.trim().slice(0, 80)
            : undefined;
    return {
        id: entry.id.trim(),
        style,
        ...(pack ? { pack } : {}),
        ...(author ? { author } : {}),
    };
}

const store = createBrowserListStore<LibraryStyle>(STORAGE_KEY, parseLibraryStyle, 'custom styles');

export const listLibraryStyles = store.list;
export const subscribeLibraryStyles = store.subscribe;
export const replaceLibraryStyles = store.write;

/** Converts a stored `LibraryStyle` entry into a `CssPiece` usable by the rich editor. */
export function libraryStyleToPiece(entry: LibraryStyle): CssPiece {
    const { style } = entry;
    return {
        id: `custom-${entry.id}`,
        label: style.label,
        description:
            style.description ||
            (style.kind === 'template' ? 'Custom template' : `.${style.className}`),
        kind: style.kind,
        className: style.className,
        ...(style.extraClasses?.length ? { extraClasses: style.extraClasses } : {}),
        previewSample: style.previewSample,
        css: style.css,
        ...(style.templateHtml ? { templateHtml: style.templateHtml } : {}),
        ...(style.previewHtml ? { previewHtml: style.previewHtml } : {}),
        ...(style.previewCss ? { previewCss: style.previewCss } : {}),
        ...(style.author || entry.author ? { author: style.author ?? entry.author } : {}),
        ...(entry.pack ? { pack: entry.pack } : {}),
        custom: true,
    };
}

/** Lists all custom styles in this browser formatted as editor `CssPiece` objects. */
export function listCustomCssPieces(): CssPiece[] {
    return listLibraryStyles().map(libraryStyleToPiece);
}

function sanitizeStoredStyle(style: StylePackStyle, cleanCssForAo3 = false): StylePackStyle {
    const normalized = normalizeStyleEntry(style);
    const sanitizedTemplate = normalized.templateHtml
        ? sanitizeStyleHtml(normalized.templateHtml).html
        : undefined;
    const sanitizedPreview = normalized.previewHtml
        ? sanitizeStyleHtml(normalized.previewHtml).html
        : undefined;

    let css = normalized.css;
    if (cleanCssForAo3 && css.trim()) {
        const { cleanedCss } = inspectStyleForAo3(normalized);
        if (cleanedCss.trim()) css = cleanedCss.trim();
    }

    return {
        ...normalized,
        css,
        ...(sanitizedTemplate ? { templateHtml: sanitizedTemplate } : {}),
        ...(sanitizedPreview ? { previewHtml: sanitizedPreview } : {}),
    };
}

/** Adds a single custom style to the browser library and returns the stored entry. */
export function saveLibraryStyle(
    style: StylePackStyle,
    meta: { pack?: string; author?: string; cleanCssForAo3?: boolean } = {}
): LibraryStyle {
    const clean = sanitizeStoredStyle(style, meta.cleanCssForAo3);
    const pack = meta.pack?.trim() || undefined;
    const author = meta.author?.trim() || clean.author || undefined;
    const entry: LibraryStyle = {
        id: nextLibraryStyleId(),
        style: clean,
        ...(pack ? { pack } : {}),
        ...(author ? { author } : {}),
    };
    store.write([...listLibraryStyles(), entry]);
    return entry;
}

/** Updates an existing custom style in place. */
export function updateLibraryStyle(
    id: string,
    style: StylePackStyle,
    meta: { pack?: string; author?: string; cleanCssForAo3?: boolean } = {}
): LibraryStyle | null {
    const entries = listLibraryStyles();
    const index = entries.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const clean = sanitizeStoredStyle(style, meta.cleanCssForAo3);
    const pack = meta.pack !== undefined ? meta.pack.trim() || undefined : entries[index].pack;
    const author =
        meta.author !== undefined
            ? meta.author.trim() || undefined
            : clean.author ?? entries[index].author;
    const updated: LibraryStyle = {
        id,
        style: clean,
        ...(pack ? { pack } : {}),
        ...(author ? { author } : {}),
    };
    const next = entries.slice();
    next[index] = updated;
    store.write(next);
    return updated;
}

export function removeLibraryStyle(id: string): void {
    store.write(listLibraryStyles().filter((entry) => entry.id !== id));
}

export function removeLibraryPack(packName: string): void {
    store.write(listLibraryStyles().filter((entry) => entry.pack !== packName));
}

/**
 * Imports every style from an `.eo3styles.json` pack into the browser library.
 * Re-importing a pack updates matching styles from the same pack in place rather than duplicating.
 */
export function importStylePack(
    pack: StylePackFile,
    options: { cleanCssForAo3?: boolean } = {}
): { added: number; updated: number; entries: LibraryStyle[] } {
    const existing = listLibraryStyles();
    const next = existing.slice();
    let added = 0;
    let updated = 0;
    const touched: LibraryStyle[] = [];

    for (const rawStyle of pack.styles) {
        const clean = sanitizeStoredStyle(rawStyle, options.cleanCssForAo3);
        const author = clean.author ?? pack.author;
        const matchIndex = next.findIndex((candidate) => {
            if (candidate.pack !== pack.title) return false;
            if (clean.id && candidate.style.id && candidate.style.id === clean.id) return true;
            return (
                candidate.style.className === clean.className &&
                candidate.style.kind === clean.kind &&
                candidate.style.label.toLowerCase() === clean.label.toLowerCase()
            );
        });

        if (matchIndex !== -1) {
            const updatedEntry: LibraryStyle = {
                id: next[matchIndex].id,
                style: clean,
                pack: pack.title,
                ...(author ? { author } : {}),
            };
            next[matchIndex] = updatedEntry;
            touched.push(updatedEntry);
            updated++;
        } else {
            const newEntry: LibraryStyle = {
                id: nextLibraryStyleId(),
                style: clean,
                pack: pack.title,
                ...(author ? { author } : {}),
            };
            next.push(newEntry);
            touched.push(newEntry);
            added++;
        }
    }

    store.write(next);
    return { added, updated, entries: touched };
}

/** Packages one or more library styles into a shareable `.eo3styles.json` file object. */
export function buildStylePackExport(
    entries: readonly LibraryStyle[],
    meta: { title: string; author?: string; description?: string }
): StylePackFile {
    const title =
        meta.title.trim() || (entries.length === 1 ? entries[0].style.label : 'Style pack');
    const author = meta.author?.trim() || undefined;
    const description = meta.description?.trim() || undefined;
    return {
        eo3: 'styles',
        version: 1,
        title,
        ...(description ? { description } : {}),
        ...(author ? { author } : {}),
        styles: entries.map((entry) => ({
            ...entry.style,
            ...(entry.style.id ? {} : { id: entry.id }),
            ...(entry.style.author
                ? {}
                : entry.author && entry.author !== author
                ? { author: entry.author }
                : {}),
        })),
    };
}
