import { JavascriptData, type JsonValue } from '../../document';

export const SETTING_TYPES = [
    'text',
    'paragraph',
    'color',
    'number',
    'toggle',
    'choice',
    'list',
] as const;
export type SettingType = typeof SETTING_TYPES[number];

/** One entry of a `list` field: a value for each of its item fields, by key. */
export type ListItem = Record<string, JsonValue>;

export type SettingDefault = string | number | boolean | ListItem[];

export interface SettingsField {
    /** The name the value is read by (`settings.Date` in Svelte). */
    key: string;
    /** What the form shows; the key when empty. */
    label?: string;
    type?: SettingType;
    /** The choices of a `choice` field. */
    options?: string[];
    /** A short explanation under the field. */
    hint?: string;
    /** Optional presentation: sections keep related controls together. */
    section?: string;
    advanced?: boolean;
    default?: SettingDefault;
    min?: number;
    max?: number;
    step?: number;
    /** A `list` field's item fields: each entry the writer adds has these. */
    fields?: SettingsField[];
    /** What one entry of a `list` is called ("Person"); "Item" when empty. */
    itemLabel?: string;
    /** How many entries a `list` keeps at least / at most. */
    minItems?: number;
    maxItems?: number;
    /** Presentation only; hiding a field preserves its value and exported key. */
    showWhen?: { key: string; equals: string | number | boolean };
}

export interface SettingsData {
    fields: SettingsField[];
    values: Record<string, JsonValue>;
    /**
     * The TypeScript or JavaScript the fields were last generated from, when the author wrote
     * them as code. `fields` always holds the result, so the form never runs code.
     */
    fieldsCode?: string;
}

export function settingType(field: SettingsField): SettingType {
    return SETTING_TYPES.includes(field.type as SettingType) ? field.type! : 'text';
}

/** A field's value, or the empty value of its type when it has none (or a value of another type). */
export function settingValue(field: SettingsField, values: SettingsData['values']): JsonValue {
    const value = Object.hasOwn(values, field.key) ? values[field.key] : field.default;
    switch (settingType(field)) {
        case 'toggle':
            return typeof value === 'boolean' ? value : false;
        case 'number':
            return constrainNumber(field, typeof value === 'number' && isFinite(value) ? value : 0);
        case 'choice': {
            const options = field.options ?? [];
            return typeof value === 'string' && options.includes(value) ? value : options[0] ?? '';
        }
        case 'color':
            return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
        case 'list': {
            const fields = itemFields(field);
            const { min, max } = listBounds(field);
            const items = (Array.isArray(value) ? value : [])
                .slice(0, max)
                .map((item) => listItemValue(fields, isRecord(item) ? item : {}));
            while (items.length < min) items.push(listItemValue(fields, {}));
            return items;
        }
        default:
            return typeof value === 'string' ? value : '';
    }
}

export function constrainNumber(field: SettingsField, value: number): number {
    const min = Number.isFinite(field.min) ? field.min! : -Infinity;
    const max = Number.isFinite(field.max) ? field.max! : Infinity;
    return min <= max ? Math.min(max, Math.max(min, value)) : value;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `list` field's item fields that have a key, first of each key only. */
export function itemFields(field: SettingsField): SettingsField[] {
    const seen = new Set<string>();
    return (field.fields ?? []).filter((f) => {
        if (!f.key || seen.has(f.key)) return false;
        seen.add(f.key);
        return true;
    });
}

/** One list entry with every item field's value (defaults for the ones it lacks). */
export function listItemValue(fields: SettingsField[], item: Record<string, JsonValue>): ListItem {
    const result: ListItem = {};
    for (const field of fields) {
        Object.defineProperty(result, field.key, {
            value: settingValue(field, item),
            enumerable: true,
            configurable: true,
            writable: true,
        });
    }
    return result;
}

/** A `list` field's entry limits; contradictory or invalid ones are ignored. */
export function listBounds(field: SettingsField): { min: number; max: number } {
    const valid = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    const min = valid(field.minItems) ? Math.floor(field.minItems!) : 0;
    const max = valid(field.maxItems) ? Math.floor(field.maxItems!) : Infinity;
    return min <= max ? { min, max } : { min: 0, max: Infinity };
}

export function settingVisible(field: SettingsField, values: Record<string, JsonValue>): boolean {
    return (
        !field.showWhen ||
        (Object.hasOwn(values, field.showWhen.key) &&
            values[field.showWhen.key] === field.showWhen.equals)
    );
}

/** Every field's value by key, in field order; fields without a key are skipped. */
export function settingsValues(data: SettingsData): Record<string, JsonValue> {
    const result: Record<string, JsonValue> = {};
    for (const field of data.fields) {
        if (field.key && !Object.hasOwn(result, field.key)) {
            Object.defineProperty(result, field.key, {
                value: settingValue(field, data.values),
                enumerable: true,
                configurable: true,
            });
        }
    }
    return result;
}

/** The module a Settings module evaluates to: `import settings from './settings'`. */
export function settingsModule(data: SettingsData): string {
    return `export default ${JSON.stringify(settingsValues(data), null, 2)};\n`;
}

/** A Settings module's output: its values module, still knowing the fields it came from. */
export class SettingsModuleData extends JavascriptData {
    fields: SettingsField[];

    constructor(data: SettingsData) {
        super(settingsModule(data));
        this.fields = data.fields;
    }
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The TypeScript type of a Settings module's default export, for showing to script authors. */
export function settingsTypeScript(fields: SettingsField[], indent = ''): string {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const field of fields) {
        if (!field.key || seen.has(field.key)) continue;
        seen.add(field.key);
        const key = IDENTIFIER.test(field.key) ? field.key : JSON.stringify(field.key);
        lines.push(`${indent}    ${key}: ${settingTypeScript(field, indent + '    ')};`);
    }
    return lines.length ? `{\n${lines.join('\n')}\n${indent}}` : '{}';
}

function settingTypeScript(field: SettingsField, indent: string): string {
    switch (settingType(field)) {
        case 'number':
            return 'number';
        case 'toggle':
            return 'boolean';
        case 'choice':
            return field.options?.length
                ? field.options.map((option) => JSON.stringify(option)).join(' | ')
                : 'string';
        case 'list':
            return `Array<${settingsTypeScript(field.fields ?? [], indent)}>`;
        default:
            return 'string';
    }
}

/**
 * Checks fields an author generated (as code or JSON) and keeps only what eo3 understands.
 * Throws with the path of the first problem.
 */
export function parseSettingsFields(value: unknown, path = 'fields'): SettingsField[] {
    if (!Array.isArray(value)) throw new Error(`${path} should be a list of fields`);
    return value.map((raw, i) => {
        const at = `${path}[${i}]`;
        if (!isRecord(raw)) throw new Error(`${at} should be an object`);
        if (typeof raw.key !== 'string' || !raw.key) throw new Error(`${at}.key should be text`);
        const field: SettingsField = { key: raw.key };
        const text = (name: 'label' | 'hint' | 'section' | 'itemLabel') => {
            if (raw[name] === undefined) return;
            if (typeof raw[name] !== 'string') throw new Error(`${at}.${name} should be text`);
            field[name] = raw[name] as string;
        };
        const number = (name: 'min' | 'max' | 'step' | 'minItems' | 'maxItems') => {
            if (raw[name] === undefined) return;
            if (typeof raw[name] !== 'number' || !Number.isFinite(raw[name]))
                throw new Error(`${at}.${name} should be a number`);
            field[name] = raw[name] as number;
        };
        if (raw.type !== undefined) {
            if (!SETTING_TYPES.includes(raw.type as SettingType))
                throw new Error(`${at}.type should be one of: ${SETTING_TYPES.join(', ')}`);
            field.type = raw.type as SettingType;
        }
        text('label');
        text('hint');
        text('section');
        text('itemLabel');
        number('min');
        number('max');
        number('step');
        number('minItems');
        number('maxItems');
        if (raw.advanced !== undefined) field.advanced = !!raw.advanced;
        if (raw.options !== undefined) {
            if (!Array.isArray(raw.options) || raw.options.some((o) => typeof o !== 'string'))
                throw new Error(`${at}.options should be a list of text`);
            field.options = raw.options as string[];
        }
        if (raw.fields !== undefined) field.fields = parseSettingsFields(raw.fields, `${at}.fields`);
        if (raw.default !== undefined) {
            const ok =
                ['string', 'number', 'boolean'].includes(typeof raw.default) ||
                (Array.isArray(raw.default) && raw.default.every(isRecord));
            if (!ok)
                throw new Error(`${at}.default should be text, a number, true/false or a list`);
            field.default = raw.default as SettingDefault;
        }
        if (raw.showWhen !== undefined) {
            const when = raw.showWhen;
            if (
                !isRecord(when) ||
                typeof when.key !== 'string' ||
                !['string', 'number', 'boolean'].includes(typeof when.equals)
            )
                throw new Error(`${at}.showWhen should be { key, equals }`);
            field.showWhen = { key: when.key, equals: when.equals as string | number | boolean };
        }
        return field;
    });
}
