import { AnyModule, Document, JsonValue, ModuleGroup } from '../../document';
import { blockSinks } from '../../linear';
import {
    SettingsData,
    SettingsField,
    settingType,
    settingValue,
} from '../../plugins/source/settings-values';
import { sanitizeAo3Fragment } from '../../targets/ao3/render';

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

/** Cleans edited HTML from a `[data-edit="rich"]` surface to keep source HTML AO3-safe. */
export function cleanEditableRichHtml(html: string, hostTag: string): string {
    const cleaned = sanitizeAo3Fragment(html);
    const temp = document.createElement('div');
    temp.innerHTML = cleaned;
    if (PHRASING_OR_SINGLE_BLOCK_HOSTS.has(hostTag.toLowerCase())) {
        flattenBlocksToBreaks(temp);
    }
    return temp.innerHTML;
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

        for (const el of Array.from(container.querySelectorAll('[data-edit-input]'))) {
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
