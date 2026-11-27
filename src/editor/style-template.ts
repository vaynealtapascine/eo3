import { sanitizeAo3Fragment } from '../targets/ao3/render';

/**
 * The template language of styles (built-in and user-made alike). A template is HTML with tags:
 *
 * | Tag                                   | Becomes                                                |
 * | ------------------------------------- | ------------------------------------------------------ |
 * | `{{selection}}`, `{{selection\|Text}}` | the selected text (lines joined by `<br>`), or `Text`  |
 * | `<p …>{{selection}}</p>`              | one such paragraph per selected line                   |
 * | `{{name}}`, `{{name\|Text}}`           | the value of the style's field `name`, or `Text`       |
 * | `{{#if name}}…{{else}}…{{/if}}`       | a part shown when a field is filled in / switched on   |
 * | `{{#lines\|Starter}}…{{/lines}}`       | its contents once per selected line (or starter line)  |
 *
 * Inside `{{#lines}}`: `{{line}}` (the whole line), `{{text}}` (the line after `Name:`),
 * `{{speaker}}` (the `Name`), `{{index}}` (1, 2, …), `{{alt:a|b|…}}` (cycles through options:
 * by speaker when every line names one of two or more speakers, else line by line), and the
 * conditions `speaker`,
 * `many-speakers` (three or more), `first` and `last`. `{{#if !name}}` negates a condition.
 *
 * Values are escaped, the template is expanded as text (so tags may sit inside attributes, such
 * as `class="{{alt:in|out}}"`), and the result is sanitized with AO3's HTML rules last.
 */

export type StyleFieldType = 'text' | 'toggle';

/** Something a style asks for when it's applied (`{{key}}` in its template). */
export interface StyleField {
    /** Name in the template. `selection` labels the selected text itself. */
    key: string;
    label: string;
    type?: StyleFieldType;
    default?: string | boolean;
    placeholder?: string;
    /** Text fields only: the style can't be applied while it's empty. */
    required?: boolean;
}

export type StyleFieldValues = Record<string, string | boolean>;

type Node =
    | { t: 'text'; v: string }
    | { t: 'var'; name: string; fallback?: string }
    | { t: 'alt'; options: string[] }
    | { t: 'if'; name: string; not: boolean; then: Node[]; else: Node[] }
    | { t: 'lines'; fallback?: string; body: Node[] };

const TAG_RE = /\{\{([\s\S]*?)\}\}/g;
const NAME_RE = /^[A-Za-z_][\w-]*$/;

/** Names a `{{#lines}}` block provides; fields can't use them. */
export const LINE_VARIABLES = ['line', 'text', 'speaker', 'index'] as const;
const LINE_CONDITIONS = ['speaker', 'many-speakers', 'first', 'last'];

/** Problems found while reading a template, for authors (`lintStyleTemplate`). */
interface ParseResult {
    nodes: Node[];
    problems: string[];
}

/** `<p attrs>{{selection}}</p>` → one paragraph per line, as before the language had blocks. */
function expandSelectionParagraphs(template: string): string {
    return template.replace(
        /<p(\s[^>]*)?>\s*\{\{\s*selection(?:\|([^}]*))?\s*\}\}\s*<\/p>/gi,
        (_m, attrs: string | undefined, fallback: string | undefined) =>
            `{{#lines${fallback !== undefined ? '|' + fallback : ''}}}<p${
                attrs ?? ''
            }>{{line}}</p>{{/lines}}`
    );
}

function parse(template: string): ParseResult {
    const problems: string[] = [];
    const root: Node[] = [];
    const stack: { node: Node & { t: 'if' | 'lines' }; inElse: boolean }[] = [];
    const out = () => {
        const top = stack[stack.length - 1];
        if (!top) return root;
        if (top.node.t === 'lines') return top.node.body;
        return top.inElse ? top.node.else : top.node.then;
    };
    const source = expandSelectionParagraphs(template);
    let last = 0;
    for (const match of source.matchAll(TAG_RE)) {
        if (match.index! > last) out().push({ t: 'text', v: source.slice(last, match.index) });
        last = match.index! + match[0].length;
        const raw = match[1];
        const tag = raw.trim();
        let m: RegExpMatchArray | null;
        if ((m = /^#if\s+(!?)\s*([\w-]+)$/.exec(tag))) {
            const node: Node & { t: 'if' } = {
                t: 'if',
                not: m[1] === '!',
                name: m[2],
                then: [],
                else: [],
            };
            out().push(node);
            stack.push({ node, inElse: false });
        } else if (tag === 'else') {
            const top = stack[stack.length - 1];
            if (top?.node.t === 'if' && !top.inElse) top.inElse = true;
            else problems.push('{{else}} without an {{#if}}.');
        } else if (tag === '/if' || tag === '/lines') {
            const top = stack.pop();
            const want = tag === '/if' ? 'if' : 'lines';
            if (!top || top.node.t !== want) {
                problems.push(`{{${tag}}} doesn’t close an open {{#${want}}}.`);
                if (top) stack.push(top);
            }
        } else if ((m = /^#lines(?:\|([\s\S]*))?$/.exec(raw.replace(/^\s+/, '')))) {
            const node: Node & { t: 'lines' } = { t: 'lines', fallback: m[1], body: [] };
            out().push(node);
            stack.push({ node, inElse: false });
        } else if ((m = /^alt:([\s\S]*)$/.exec(tag))) {
            out().push({ t: 'alt', options: m[1].split('|').map((s) => s.trim()) });
        } else {
            const bar = raw.indexOf('|');
            const name = (bar >= 0 ? raw.slice(0, bar) : raw).trim();
            if (NAME_RE.test(name)) {
                out().push({
                    t: 'var',
                    name,
                    ...(bar >= 0 ? { fallback: raw.slice(bar + 1) } : {}),
                });
            } else {
                problems.push(`Unknown tag {{${tag}}}.`);
                out().push({ t: 'text', v: match[0] });
            }
        }
    }
    if (last < source.length) out().push({ t: 'text', v: source.slice(last) });
    for (const open of stack) problems.push(`{{#${open.node.t}}} is never closed.`);
    return { nodes: root, problems };
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const SPEAKER_RE = /^([^:\n]{1,24}):\s+(.+)$/;

interface Line {
    line: string;
    text: string;
    speaker: string | null;
}

interface LinesContext {
    lines: Line[];
    speakers: string[];
    allNamed: boolean;
    i: number;
}

interface Context {
    selectionLines: string[];
    values: StyleFieldValues;
    fallback: string;
    lines?: LinesContext;
}

function splitLines(text: string): string[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function linesContext(raw: string[]): LinesContext {
    const lines = raw.map((line): Line => {
        const m = SPEAKER_RE.exec(line);
        return m
            ? { line, speaker: m[1].trim(), text: m[2].trim() }
            : { line, speaker: null, text: line };
    });
    const speakers: string[] = [];
    for (const { speaker } of lines)
        if (speaker && !speakers.includes(speaker)) speakers.push(speaker);
    return { lines, speakers, allNamed: !!speakers.length && lines.every((l) => l.speaker), i: 0 };
}

function truthy(value: string | boolean | undefined): boolean {
    return typeof value === 'string' ? value.trim() !== '' : !!value;
}

function condition(name: string, ctx: Context): boolean {
    const lc = ctx.lines;
    if (lc && LINE_CONDITIONS.includes(name)) {
        const line = lc.lines[lc.i];
        switch (name) {
            case 'speaker':
                return !!line.speaker;
            case 'many-speakers':
                return lc.allNamed && lc.speakers.length > 2;
            case 'first':
                return lc.i === 0;
            case 'last':
                return lc.i === lc.lines.length - 1;
        }
    }
    if (name === 'selection') return ctx.selectionLines.length > 0;
    return truthy(ctx.values[name]);
}

function variable(name: string, fallback: string | undefined, ctx: Context): string {
    const lc = ctx.lines;
    if (lc && (LINE_VARIABLES as readonly string[]).includes(name)) {
        const line = lc.lines[lc.i];
        if (name === 'index') return String(lc.i + 1);
        const value =
            name === 'line' ? line.line : name === 'text' ? line.text : line.speaker ?? '';
        return escapeHtml(value || fallback || '');
    }
    if (name === 'selection') {
        if (ctx.selectionLines.length) return ctx.selectionLines.map(escapeHtml).join('<br>');
        return escapeHtml((fallback ?? ctx.fallback).trim() || ctx.fallback);
    }
    const value = ctx.values[name];
    const text = typeof value === 'boolean' ? (value ? 'true' : '') : value ?? '';
    return escapeHtml(text.trim() ? text : fallback ?? '');
}

function render(nodes: Node[], ctx: Context): string {
    let html = '';
    for (const node of nodes) {
        switch (node.t) {
            case 'text':
                html += node.v;
                break;
            case 'var':
                html += variable(node.name, node.fallback, ctx);
                break;
            case 'alt': {
                const lc = ctx.lines;
                if (!lc || !node.options.length) break;
                const line = lc.lines[lc.i];
                const bySpeaker = lc.allNamed && lc.speakers.length > 1;
                const n = bySpeaker ? lc.speakers.indexOf(line.speaker!) : lc.i;
                html += escapeHtml(node.options[n % node.options.length]);
                break;
            }
            case 'if':
                html += render(condition(node.name, ctx) !== node.not ? node.then : node.else, ctx);
                break;
            case 'lines': {
                let raw = ctx.selectionLines;
                if (!raw.length) {
                    raw = splitLines(node.fallback ?? '');
                    if (!raw.length) raw = [ctx.fallback];
                }
                const lc = linesContext(raw);
                for (lc.i = 0; lc.i < lc.lines.length; lc.i++) {
                    html += render(node.body, { ...ctx, lines: lc });
                }
                break;
            }
        }
    }
    return html;
}

/** A field's value when the writer hasn't given one. */
export function fieldDefault(field: StyleField): string | boolean {
    if (field.type === 'toggle') return typeof field.default === 'boolean' ? field.default : false;
    return typeof field.default === 'string' ? field.default : '';
}

/** Every field's value: what was given, else its default. */
export function fieldValues(
    fields: readonly StyleField[] = [],
    given: StyleFieldValues = {}
): StyleFieldValues {
    const values: StyleFieldValues = {};
    for (const field of fields) {
        const value = Object.hasOwn(given, field.key) ? given[field.key] : fieldDefault(field);
        values[field.key] =
            field.type === 'toggle' ? value === true : typeof value === 'string' ? value : '';
    }
    return values;
}

/** Renders a style's template into AO3-safe HTML. */
export function renderStyleTemplate(
    templateHtml: string,
    options: {
        selection?: string;
        fields?: readonly StyleField[];
        values?: StyleFieldValues;
        /** Text used where the template gives none and nothing is selected. */
        fallback?: string;
    } = {}
): string {
    const { nodes } = parse(templateHtml);
    const html = render(nodes, {
        selectionLines: splitLines(options.selection ?? ''),
        values: fieldValues(options.fields, options.values),
        fallback: options.fallback ?? 'Your text here…',
    });
    return sanitizeAo3Fragment(html);
}

/** Template mistakes worth telling a style author about. */
export function lintStyleTemplate(
    templateHtml: string,
    fields: readonly StyleField[] = []
): string[] {
    const { nodes, problems } = parse(templateHtml);
    const known = new Set(['selection', ...fields.map((f) => f.key)]);
    const walk = (list: Node[], inLines: boolean) => {
        for (const node of list) {
            if (node.t === 'var' && !known.has(node.name)) {
                if (!(inLines && (LINE_VARIABLES as readonly string[]).includes(node.name)))
                    problems.push(
                        (LINE_VARIABLES as readonly string[]).includes(node.name)
                            ? `{{${node.name}}} only works inside {{#lines}}…{{/lines}}.`
                            : `{{${node.name}}} isn’t a field of this style. Add a field called “${node.name}”.`
                    );
            } else if (node.t === 'alt' && !inLines) {
                problems.push('{{alt:…}} only works inside {{#lines}}…{{/lines}}.');
            } else if (node.t === 'if') {
                if (!known.has(node.name) && !(inLines && LINE_CONDITIONS.includes(node.name)))
                    problems.push(`{{#if ${node.name}}} doesn’t name a field of this style.`);
                walk(node.then, inLines);
                walk(node.else, inLines);
            } else if (node.t === 'lines') {
                walk(node.body, true);
            }
        }
    };
    walk(nodes, false);
    return [...new Set(problems)];
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unescapeHtml(text: string): string {
    return text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

/**
 * Reads the text and field values back out of HTML an inline template made, so it can be
 * edited again. Returns null when the HTML doesn't match the template (edited by hand, or the
 * template changed since).
 */
export function matchStyleTemplate(
    templateHtml: string,
    fields: readonly StyleField[],
    html: string
): { selection: string; values: StyleFieldValues } | null {
    const toggles = fields.filter((f) => f.type === 'toggle').slice(0, 4);
    const texts = fields.filter((f) => f.type !== 'toggle' && f.key !== 'selection');
    const sentinel = (i: number) => `eo3slot${i}x9q`;
    for (let combo = 0; combo < 1 << toggles.length; combo++) {
        const values: StyleFieldValues = {};
        toggles.forEach((f, i) => (values[f.key] = !!(combo & (1 << i))));
        texts.forEach((f, i) => (values[f.key] = sentinel(i + 1)));
        const rendered = renderStyleTemplate(templateHtml, {
            selection: sentinel(0),
            fields,
            values,
        });
        const seen = new Set<number>();
        const pattern = escapeRegex(rendered).replace(/eo3slot(\d+)x9q/g, (_m, n: string) => {
            if (seen.has(+n)) return `\\k<s${n}>`;
            seen.add(+n);
            // Values are escaped text, so a slot never spans a tag (but selections keep `<br>`).
            return `(?<s${n}>(?:[^<]|<br>)*?)`;
        });
        const m = new RegExp(`^${pattern}$`).exec(html);
        if (!m) continue;
        const result: StyleFieldValues = { ...values };
        texts.forEach((f, i) => (result[f.key] = unescapeHtml(m.groups?.[`s${i + 1}`] ?? '')));
        return { selection: unescapeHtml(m.groups?.s0 ?? ''), values: result };
    }
    return null;
}
