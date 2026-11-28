import { AnyModule, Document, JsonValue, ModuleGroup } from '../../document';
import { blockSinks } from '../../linear';
import {
    SettingsData,
    SettingsField,
    settingType,
    settingValue,
} from '../../plugins/source/settings-values';
import { UNSUITABLE_CHARS } from '../../targets/ao3/render';
import { fixBadCharacters } from '../../targets/ao3/render/fix-bad-characters';
import { isEo3EditorAttr, sanitizeFragment } from '../../targets/ao3/render/sanitize';
import { buildContentConfig } from '../../targets/ao3/render/transformers';
import {
    fillLineFormat,
    LineContent,
    SourceLineKind,
    sourceLineKind,
} from '../../editor/source-lines';

export type EditableMode = 'text' | 'rich';

export interface ResolvedSettingsField {
    module: AnyModule;
    data: SettingsData;
    field: SettingsField;
    value: JsonValue;
}

export interface TextHelpMetadata {
    summary?: string;
    examples?: { syntax: string; description: string }[];
}

const PHRASING_OR_SINGLE_BLOCK_HOSTS = new Set([
    'a',
    'abbr',
    'b',
    'cite',
    'code',
    'dd',
    'del',
    'dfn',
    'dt',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'i',
    'ins',
    'kbd',
    'li',
    'p',
    'q',
    's',
    'samp',
    'small',
    'span',
    'strike',
    'strong',
    'sub',
    'summary',
    'sup',
    'td',
    'th',
    'u',
    'var',
]);

function isHtmlTextModule(mod: AnyModule | undefined): mod is AnyModule {
    if (!mod || mod.plugin.id !== 'source.text') return false;
    const lang = (mod.data as { language?: string } | null)?.language;
    return lang === 'html' || lang === 'html-contenteditable';
}

function isNonCssTextModule(mod: AnyModule | undefined): mod is AnyModule {
    if (!mod || mod.plugin.id !== 'source.text') return false;
    const lang = (mod.data as { language?: string } | null)?.language;
    return lang !== 'css';
}

/** Finds the HTML `source.text` module backing `[data-eo3-editable]` slots for a block or module. */
export function findHtmlSourceModule(
    doc: Document,
    group?: ModuleGroup,
    module?: AnyModule
): AnyModule | null {
    if (module && isHtmlTextModule(module)) return module;
    if (!group) return null;
    for (const sink of blockSinks(group, doc.modules)) {
        if (isHtmlTextModule(sink)) return sink;
    }
    for (const id of group.moduleIds) {
        const mod = doc.findModule(id);
        if (isHtmlTextModule(mod)) return mod;
    }
    return null;
}

/** Resolves a `[data-eo3-field="<key>"]` binding against `source.settings` modules in the group. */
export function findSettingsField(
    doc: Document,
    group: ModuleGroup | undefined,
    fieldKey: string
): ResolvedSettingsField | null {
    if (!group || !fieldKey.trim()) return null;
    const needle = fieldKey.trim();
    const needleLower = needle.toLowerCase();

    let caseInsensitiveMatch: ResolvedSettingsField | null = null;
    for (const id of group.moduleIds) {
        const mod = doc.findModule(id);
        if (!mod || mod.plugin.id !== 'source.settings') continue;
        const data = mod.data as unknown as SettingsData | null;
        if (!data || !Array.isArray(data.fields)) continue;
        for (const field of data.fields) {
            if (!field.key) continue;
            if (field.key === needle) {
                return {
                    module: mod,
                    data,
                    field,
                    value: settingValue(field, data.values ?? {}),
                };
            }
            if (!caseInsensitiveMatch && field.key.toLowerCase() === needleLower) {
                caseInsensitiveMatch = {
                    module: mod,
                    data,
                    field,
                    value: settingValue(field, data.values ?? {}),
                };
            }
        }
    }
    return caseInsensitiveMatch;
}

/** Resolves a `[data-eo3-input="<name>"]` binding to a `source.text` input module in the group. */
export function findNamedInputModule(
    doc: Document,
    group: ModuleGroup | undefined,
    inputName: string
): AnyModule | null {
    if (!group) return null;
    const memberSet = new Set(group.moduleIds);
    const needle = inputName.trim().toLowerCase();

    // 1. Exact/case-insensitive match via namedSends (e.g. `draft` -> Compose)
    if (needle) {
        for (const id of group.moduleIds) {
            const mod = doc.findModule(id);
            if (!isNonCssTextModule(mod)) continue;
            // `namedSends` is a Map of receiving module id → the names it is sent under.
            for (const [targetId, names] of mod.namedSends) {
                if (!memberSet.has(targetId)) continue;
                for (const name of names) {
                    if (name.toLowerCase() === needle) return mod;
                }
            }
        }
    }

    // 2. Match against group input labels
    if (needle && group.inputs) {
        for (const input of group.inputs) {
            if (input.label.trim().toLowerCase() === needle) {
                const mod = doc.findModule(input.moduleId);
                if (isNonCssTextModule(mod)) return mod;
            }
        }
    }

    // 3. Fallback when name is empty or 'draft': first non-CSS text module in group inputs, else members
    if (!needle || needle === 'draft') {
        for (const input of group.inputs ?? []) {
            const mod = doc.findModule(input.moduleId);
            if (isNonCssTextModule(mod)) return mod;
        }
        for (const id of group.moduleIds) {
            const mod = doc.findModule(id);
            if (isNonCssTextModule(mod)) return mod;
        }
    }

    return null;
}

/** Updates a single setting key inside a `source.settings` module. */
export function updateSettingsFieldValue(
    doc: Document,
    moduleId: string,
    fieldKey: string,
    nextValue: JsonValue
): void {
    const current = doc.findModule(moduleId);
    if (!current || current.plugin.id !== 'source.settings') return;
    const data = current.data as unknown as SettingsData;
    if (!data) return;
    if (data.values?.[fieldKey] === nextValue) return;
    const next = current.shallowClone();
    next.data = {
        ...data,
        values: { ...(data.values ?? {}), [fieldKey]: nextValue },
    } as unknown as JsonValue;
    doc.insertModule(next);
}

/** Updates `data.contents` on a `source.text` module. */
export function updateTextModuleContents(
    doc: Document,
    moduleId: string,
    nextContents: string
): void {
    const current = doc.findModule(moduleId);
    if (!current || current.plugin.id !== 'source.text') return;
    const data = current.data as Record<string, JsonValue> | null;
    if (data && data.contents === nextContents) return;
    const next = current.shallowClone();
    next.data = {
        ...(data ?? {}),
        contents: nextContents,
    };
    doc.insertModule(next);
}

/** Returns top-level `[data-edit]` elements inside `root` (skipping nested ones). */
export function topLevelEditableSlots(root: ParentNode): Element[] {
    const all = Array.from(root.querySelectorAll('[data-edit]'));
    return all.filter((el) => {
        let parent = el.parentElement;
        while (parent && parent !== root) {
            if (parent.hasAttribute('data-edit')) return false;
            parent = parent.parentElement;
        }
        return true;
    });
}

/**
 * Stamps deterministic `data-edit-slot-index` attributes onto top-level `[data-edit]`
 * elements before AO3 preview rendering so edits always map back to the exact source element.
 */
export function stampEditableSlots(html: string): string {
    if (!html.includes('data-edit')) return html;
    const root = document.createElement('div');
    root.innerHTML = html;
    const slots = topLevelEditableSlots(root);
    if (!slots.length) return html;
    slots.forEach((el, index) => {
        el.setAttribute('data-edit-slot-index', String(index));
    });
    return root.innerHTML;
}

/** Reads the editable mode (`text` vs `rich`) from an element's `data-edit` attribute. */
export function editableModeOf(el: Element): EditableMode {
    const raw = (el.getAttribute('data-edit') ?? '').trim().toLowerCase();
    return raw === 'rich' ? 'rich' : 'text';
}

/** Converts contenteditable block wrappers (`<div>`, `<p>`) into `<br>` lines for inline/single-block hosts. */
function flattenBlocksToBreaks(root: HTMLElement): void {
    const blockTags = new Set(['DIV', 'P']);
    let changed = true;
    while (changed) {
        changed = false;
        for (const child of Array.from(root.childNodes)) {
            if (child.nodeType === Node.ELEMENT_NODE && blockTags.has((child as Element).tagName)) {
                const el = child as HTMLElement;
                const hasPrevContent =
                    el.previousSibling !== null &&
                    (el.previousSibling.nodeType !== Node.TEXT_NODE ||
                        (el.previousSibling.textContent ?? '').length > 0);
                if (hasPrevContent) {
                    const prev = el.previousSibling;
                    if (
                        !(
                            prev?.nodeType === Node.ELEMENT_NODE &&
                            (prev as Element).tagName === 'BR'
                        )
                    ) {
                        root.insertBefore(document.createElement('br'), el);
                    }
                }
                while (el.firstChild) root.insertBefore(el.firstChild, el);
                el.remove();
                changed = true;
                break;
            }
        }
    }
    // Remove a single trailing <br> browser contenteditable inserts on empty lines
    while (
        root.lastChild &&
        root.lastChild.nodeType === Node.ELEMENT_NODE &&
        (root.lastChild as Element).tagName === 'BR' &&
        root.childNodes.length === 1
    ) {
        root.lastChild.remove();
    }
}

/**
 * Makes edited rich HTML (`data-edit="rich"` slots, `data-edit-mode="rich"` line parts) safe to
 * show and save: AO3's sanitizer, but keeping `style` attributes, which eo3 moves into the Work
 * Skin on export so AO3 never sees them. Paragraphs become `<br>`s inside phrasing hosts. It is
 * parsed in an inert document, so nothing in it loads or runs.
 */
export function cleanEditableRichHtml(html: string, hostTag: string): string {
    const inert = document.implementation.createHTMLDocument('');
    const root = inert.createElement('myroot');
    root.innerHTML = fixBadCharacters(html).replace(UNSUITABLE_CHARS, '');
    const styles: string[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
            if (isEo3EditorAttr(attr.name)) el.removeAttribute(attr.name);
        }
        const style = el.getAttribute('style');
        if (style) el.setAttribute('data-edit-style', String(styles.push(style) - 1));
    }
    // Editor markers survive this pass, which carries the styles through it.
    sanitizeFragment(root, buildContentConfig(), undefined, { preserveEditorMarkers: true });
    for (const el of Array.from(root.querySelectorAll('*'))) {
        const kept = el.getAttribute('data-edit-style');
        for (const attr of Array.from(el.attributes)) {
            if (isEo3EditorAttr(attr.name)) el.removeAttribute(attr.name);
        }
        const style = kept === null ? undefined : styles[Number(kept)];
        if (style) el.setAttribute('style', style);
    }
    if (PHRASING_OR_SINGLE_BLOCK_HOSTS.has(hostTag.toLowerCase())) {
        flattenBlocksToBreaks(root);
    }
    return root.innerHTML.replace(/&nbsp;/g, ' ');
}

/** Writes an edited slot value back into the underlying HTML template string. */
export function writeEditableSlot(
    sourceHtml: string,
    slotIndex: number,
    mode: EditableMode,
    nextValue: string
): string {
    const root = document.createElement('div');
    root.innerHTML = sourceHtml;
    const slots = topLevelEditableSlots(root);
    const target = slots[slotIndex];
    if (!target) return sourceHtml;
    if (mode === 'rich') {
        target.innerHTML = cleanEditableRichHtml(nextValue, target.tagName);
    } else {
        target.textContent = nextValue;
    }
    return root.innerHTML;
}

/** Whether a `SettingsField` can be edited directly in-place as a text/paragraph/number/choice control. */
export function isInlineEditableSetting(field: SettingsField): boolean {
    const t = settingType(field);
    return t === 'text' || t === 'paragraph' || t === 'number' || t === 'choice';
}

/**
 * Marks only resolvable `[data-edit]` / `[data-edit-*]` nodes inside `container` with
 * `data-edit-interactive` so hover rings and click affordances only appear on elements wired to
 * real document data.
 */
export function annotateInteractivePreview(
    container: HTMLElement,
    doc: Document,
    group?: ModuleGroup,
    module?: AnyModule
): boolean {
    let any = false;
    const htmlMod = findHtmlSourceModule(doc, group, module);

    if (htmlMod) {
        for (const el of topLevelEditableSlots(container)) {
            if (!el.hasAttribute('data-edit-slot-index')) continue;
            el.setAttribute('data-edit-interactive', 'editable');
            if (!el.getAttribute('title')) {
                const mode = editableModeOf(el);
                el.setAttribute(
                    'title',
                    mode === 'rich' ? 'Click to edit formatted text' : 'Click to edit text'
                );
            }
            any = true;
        }
    }

    if (group) {
        for (const el of Array.from(container.querySelectorAll('[data-edit-field]'))) {
            const key = el.getAttribute('data-edit-field') ?? '';
            const resolved = findSettingsField(doc, group, key);
            if (!resolved || !isInlineEditableSetting(resolved.field)) continue;
            el.setAttribute('data-edit-interactive', 'field');
            if (!el.getAttribute('title')) {
                el.setAttribute(
                    'title',
                    `Click to edit ${resolved.field.label || resolved.field.key}`
                );
            }
            any = true;
        }

        for (const line of Array.from(
            container.querySelectorAll<HTMLElement>('[data-edit-line]')
        )) {
            if (!resolveLine(line, doc, group)) continue;
            line.setAttribute('data-edit-line-ready', '');
            for (const part of lineParts(line)) {
                const options = parsePartOptions(part.getAttribute('data-edit-options'));
                const label = partLabel(part);
                part.setAttribute('data-edit-interactive', options ? 'choice' : 'part');
                if (!part.getAttribute('title')) {
                    part.setAttribute(
                        'title',
                        options ? `Click to choose ${label.toLowerCase()}` : 'Click to edit'
                    );
                }
            }
            any = true;
        }

        for (const el of Array.from(container.querySelectorAll('[data-edit-input]'))) {
            // A line naming its input, or a region whose lines are mapped one by one, is edited
            // line by line instead.
            if (el.matches('[data-edit-line]') || el.querySelector('[data-edit-line]')) continue;
            const name = el.getAttribute('data-edit-input') ?? '';
            const targetMod = findNamedInputModule(doc, group, name);
            if (!targetMod) continue;
            el.setAttribute('data-edit-interactive', 'input');
            if (!el.getAttribute('title')) {
                const inputEntry = group.inputs?.find((i) => i.moduleId === targetMod.id);
                const label = inputEntry?.label || targetMod.title || name || 'text';
                el.setAttribute('title', `Click to edit ${label}`);
            }
            any = true;
        }
    }

    return any;
}

// ── Line-mapped templates (`data-edit-line`, `data-edit-part`; docs/inline-editing.md) ──

export interface PartOption {
    value: string;
    label: string;
}

/**
 * Parses `data-edit-options`: a JSON array of strings or `{ value, label }` objects, or
 * `|`-separated values. Returns null when there are no usable options.
 */
export function parsePartOptions(raw: string | null): PartOption[] | null {
    if (raw === null || !raw.trim()) return null;
    let items: unknown[];
    if (raw.trim().startsWith('[')) {
        try {
            const parsed: unknown = JSON.parse(raw);
            items = Array.isArray(parsed) ? parsed : [];
        } catch {
            return null;
        }
    } else {
        items = raw.split('|').map((v) => v.trim());
    }
    const options: PartOption[] = [];
    for (const item of items) {
        if (typeof item === 'string' || typeof item === 'number') {
            const value = String(item);
            if (value) options.push({ value, label: value });
        } else if (item && typeof item === 'object' && 'value' in item) {
            const { value, label } = item as { value: unknown; label?: unknown };
            if (value === undefined || value === null) continue;
            options.push({ value: String(value), label: String(label ?? value) });
        }
    }
    return options.length ? options : null;
}

/** The input a line belongs to: `data-edit-input` on the line or its nearest ancestor. */
export function lineInputName(line: Element): string {
    return line.closest('[data-edit-input]')?.getAttribute('data-edit-input') ?? '';
}

/** A line's parts (`data-edit-part`, not counting nested lines'); a line without parts is its own. */
export function lineParts(line: HTMLElement): HTMLElement[] {
    const parts = Array.from(line.querySelectorAll<HTMLElement>('[data-edit-part]')).filter(
        (part) => part.parentElement?.closest('[data-edit-line]') === line
    );
    return parts.length ? parts : [line];
}

export function partName(part: Element): string {
    return part.getAttribute('data-edit-part') || 'text';
}

export function partLabel(part: Element): string {
    const label = part.getAttribute('data-edit-label');
    if (label) return label;
    const name = partName(part);
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A part's source value: `data-edit-value` when the template gives one, else its text. */
export function partValue(part: Element): string {
    return part.getAttribute('data-edit-value') ?? part.textContent ?? '';
}

/** Whether a part holds formatted text (`data-edit-mode="rich"`), edited and written as HTML. */
export function isRichPart(part: Element): boolean {
    return (part.getAttribute('data-edit-mode') ?? '').trim().toLowerCase() === 'rich';
}

/**
 * A rich part's HTML as the template wrote it. The preview turns inline styles into generated
 * classes, so `stampRichParts` keeps the original in `data-edit-source` before rendering.
 */
export function richPartHtml(part: Element): string {
    return part.getAttribute('data-edit-source') ?? part.innerHTML;
}

/**
 * Copies the HTML of each rich line part (`data-edit-mode="rich"`) and rich slot
 * (`data-edit="rich"`) into `data-edit-source` before the AO3 preview render, which rewrites
 * `style` attributes into `eo3-<hash>` classes that mean nothing in the source.
 */
export function stampRichParts(html: string): string {
    if (!html.includes('data-edit')) return html;
    const root = document.createElement('div');
    root.innerHTML = html;
    let any = false;
    for (const part of Array.from(root.querySelectorAll('[data-edit-mode], [data-edit]'))) {
        if (!isRichPart(part) && editableModeOf(part) !== 'rich') continue;
        part.setAttribute('data-edit-source', part.innerHTML);
        any = true;
    }
    return any ? root.innerHTML : html;
}

/** `cleanEditableRichHtml` for a line part: one source line, so paragraphs become `<br>`s. */
export function cleanRichPartHtml(html: string): string {
    return cleanEditableRichHtml(html, 'span');
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
export function escapeHtmlText(text: string): string {
    return text.replace(/[&<>]/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Rebuilds a line's source from its parts through `data-edit-format` (default: the parts'
 * values in order), with `overrides` replacing some parts' values: HTML for rich parts, text
 * for the rest. A line with a rich part is HTML, with its text parts and format escaped.
 */
export function lineContent(
    line: HTMLElement,
    overrides: Record<string, string> = {}
): LineContent {
    const parts = lineParts(line);
    const html = parts.some(isRichPart);
    const rich = new Set(parts.filter(isRichPart).map(partName));
    const values: Record<string, string> = {};
    for (const part of parts) {
        values[partName(part)] = isRichPart(part) ? richPartHtml(part) : partValue(part);
    }
    Object.assign(values, overrides);
    if (html) {
        for (const key of Object.keys(values)) {
            if (!rich.has(key)) values[key] = escapeHtmlText(values[key]);
        }
    }
    const format =
        line.getAttribute('data-edit-format') ??
        parts.map((part) => `{${partName(part)}}`).join('');
    const value = fillLineFormat(format, values, html ? escapeHtmlText : undefined).replace(
        /\s*[\r\n]+\s*/g,
        ' '
    );
    return { value, html };
}

/** A line's rebuilt source as text (rich parts' markup included as written). */
export function lineSourceText(line: HTMLElement, overrides: Record<string, string> = {}): string {
    return lineContent(line, overrides).value;
}

export interface ResolvedLine {
    module: AnyModule;
    index: number;
}

/** Resolves a `[data-edit-line]` element to its input module and source line index. */
export function resolveLine(
    line: Element,
    doc: Document,
    group: ModuleGroup | undefined
): ResolvedLine | null {
    if (!group) return null;
    const raw = line.getAttribute('data-edit-line') ?? '';
    const index = Number(raw);
    if (!raw.trim() || !Number.isInteger(index) || index < 0) return null;
    const mod = findNamedInputModule(doc, group, lineInputName(line));
    return mod ? { module: mod, index } : null;
}

/** Finds the rendered line showing source line `index` of module `moduleId`. */
export function findLineElement(
    container: ParentNode,
    doc: Document,
    group: ModuleGroup | undefined,
    moduleId: string,
    index: number
): HTMLElement | null {
    for (const line of Array.from(
        container.querySelectorAll<HTMLElement>(`[data-edit-line="${index}"]`)
    )) {
        if (resolveLine(line, doc, group)?.module.id === moduleId) return line;
    }
    return null;
}

/** Rewrites a text module's source through `edit`; returns whether anything changed. */
export function editSourceLines(
    doc: Document,
    moduleId: string,
    edit: (source: string, kind: SourceLineKind) => string
): boolean {
    const mod = doc.findModule(moduleId);
    if (!mod || mod.plugin.id !== 'source.text') return false;
    const data = mod.data as { contents?: unknown; language?: string } | null;
    const source = String(data?.contents ?? '');
    const next = edit(source, sourceLineKind(data?.language));
    if (next === source) return false;
    updateTextModuleContents(doc, moduleId, next);
    return true;
}
