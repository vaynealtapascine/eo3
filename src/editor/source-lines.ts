/**
 * Line-level reads and writes on a text module's source, for templates that map each piece of
 * their output back to one source line (`data-edit-line`, see docs/inline-editing.md).
 *
 * What a "line" is depends on the source:
 * -   HTML (`html`, `html-contenteditable`): each top-level element, usually a `<p>`. Text and
 *     comments between them are kept but are not lines.
 * -   Anything else (plain text, Markdown…): each `\n`-separated line.
 *
 * Templates must count lines the same way, or edits land on the wrong line.
 */

export type SourceLineKind = 'html' | 'text';

/** Which line model a `source.text` module's language uses. */
export function sourceLineKind(language: string | undefined): SourceLineKind {
    return language === 'html' || language === 'html-contenteditable' ? 'html' : 'text';
}

function parseHtml(source: string): HTMLDivElement {
    const root = document.createElement('div');
    root.innerHTML = source;
    return root;
}

function htmlLines(root: HTMLElement): Element[] {
    return Array.from(root.children);
}

function splitText(source: string): { lines: string[]; eol: string } {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    return { lines: source.split(/\r?\n/), eol };
}

/** The text of each line. */
export function readSourceLines(source: string, kind: SourceLineKind): string[] {
    if (kind === 'html') return htmlLines(parseHtml(source)).map((el) => el.textContent ?? '');
    return source === '' ? [] : splitText(source).lines;
}

/** A line's new contents: plain text, or HTML when `html` is set. */
export interface LineContent {
    value: string;
    html?: boolean;
}

function asContent(content: string | LineContent): LineContent {
    return typeof content === 'string' ? { value: content } : content;
}

/** The content as plain text, for sources that hold no HTML. */
function contentText({ value, html }: LineContent): string {
    if (!html) return value;
    const el = document.createElement('div');
    el.innerHTML = value;
    return el.textContent ?? '';
}

function setLine(line: Element, { value, html }: LineContent): void {
    if (html) line.innerHTML = value;
    else line.textContent = value;
}

function lineHas(line: Element, { value, html }: LineContent): boolean {
    return (html ? line.innerHTML : line.textContent) === value;
}

/**
 * Replaces line `index`. An HTML line keeps its element (tag and attributes); its contents
 * become the given text, or the given HTML. Plain-text sources take the HTML's text.
 */
export function replaceSourceLine(
    source: string,
    kind: SourceLineKind,
    index: number,
    content: string | LineContent
): string {
    const next = asContent(content);
    if (kind === 'html') {
        const root = parseHtml(source);
        const line = htmlLines(root)[index];
        if (!line || lineHas(line, next)) return source;
        setLine(line, next);
        return root.innerHTML;
    }
    const text = contentText(next);
    const { lines, eol } = splitText(source);
    if (index < 0 || index >= lines.length || lines[index] === text) return source;
    lines[index] = text;
    return lines.join(eol);
}

/**
 * Inserts a line holding `content` after line `afterIndex` (-1 inserts at the start). A new HTML
 * line copies the element of the line it follows (or precedes, at the start), else is a `<p>`.
 */
export function insertSourceLine(
    source: string,
    kind: SourceLineKind,
    afterIndex: number,
    content: string | LineContent
): string {
    const next = asContent(content);
    if (kind === 'html') {
        const root = parseHtml(source);
        const lines = htmlLines(root);
        const model = lines[afterIndex] ?? lines[afterIndex + 1] ?? lines[lines.length - 1];
        const line = model ? (model.cloneNode(false) as Element) : document.createElement('p');
        setLine(line, next);
        const anchor = lines[afterIndex];
        if (anchor) anchor.after(line);
        else if (afterIndex < 0 && lines[0]) lines[0].before(line);
        else root.append(line);
        return root.innerHTML;
    }
    const text = contentText(next);
    if (source === '') return text;
    const { lines, eol } = splitText(source);
    const at = Math.max(0, Math.min(afterIndex + 1, lines.length));
    lines.splice(at, 0, text);
    return lines.join(eol);
}

/** Removes line `index`. */
export function removeSourceLine(source: string, kind: SourceLineKind, index: number): string {
    if (kind === 'html') {
        const root = parseHtml(source);
        const line = htmlLines(root)[index];
        if (!line) return source;
        line.remove();
        return root.innerHTML;
    }
    const { lines, eol } = splitText(source);
    if (index < 0 || index >= lines.length) return source;
    lines.splice(index, 1);
    return lines.join(eol);
}

/** Swaps line `index` with its neighbour above (`-1`) or below (`1`). */
export function moveSourceLine(
    source: string,
    kind: SourceLineKind,
    index: number,
    delta: -1 | 1
): string {
    const other = index + delta;
    if (kind === 'html') {
        const root = parseHtml(source);
        const lines = htmlLines(root);
        const line = lines[index];
        const neighbour = lines[other];
        if (!line || !neighbour) return source;
        if (delta < 0) neighbour.before(line);
        else neighbour.after(line);
        return root.innerHTML;
    }
    const { lines, eol } = splitText(source);
    if (index < 0 || other < 0 || index >= lines.length || other >= lines.length) return source;
    [lines[index], lines[other]] = [lines[other], lines[index]];
    return lines.join(eol);
}

/**
 * Fills a line format such as `{speaker}:: {text}` with part values. `{{` and `}}` are literal
 * braces; a part with no value becomes empty.
 */
export function fillLineFormat(
    format: string,
    values: Record<string, string>,
    /** Applied to the format's own text (not the values), e.g. to escape it for HTML. */
    literal: (text: string) => string = (text) => text
): string {
    return literal(format).replace(
        /\{\{|\}\}|\{([A-Za-z0-9_-]+)\}/g,
        (match, key: string | undefined) => {
            if (match === '{{') return '{';
            if (match === '}}') return '}';
            return values[key!] ?? '';
        }
    );
}
