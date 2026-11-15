import type { Document } from '../document';

/** Scripts written without spaces between words: each character counts, as on AO3. */
const UNSPACED =
    '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Thai}\\p{Script=Khmer}\\p{Script=Lao}';
const WORD = new RegExp(
    `[${UNSPACED}]|(?:(?![${UNSPACED}])[\\p{L}\\p{N}])(?:(?![${UNSPACED}])[\\p{L}\\p{N}\\p{M}'’-])*`,
    'gu'
);

/**
 * Words a reader would see in a piece of HTML or plain text: tags, comments and the contents of
 * `<style>` and `<script>` don't count. Close to the count sites show, not identical to it.
 */
export function countWords(html: string): number {
    const text = html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ');
    return text.match(WORD)?.length ?? 0;
}

/** Text module languages that hold writing rather than styles or scripts. */
const WRITING = new Set(['text', 'html', 'html-contenteditable']);

/**
 * Words written in a work, counted from its text modules without evaluating anything, so it
 * also works on a version read back from history.
 */
export function workWordCount(doc: Document): number {
    let words = 0;
    for (const module of doc.modules) {
        if (module.plugin.id !== 'source.text') continue;
        const data = module.data as { contents?: unknown; language?: unknown } | null;
        if (typeof data?.contents !== 'string' || !WRITING.has(String(data.language))) continue;
        words += countWords(data.contents);
    }
    return words;
}
