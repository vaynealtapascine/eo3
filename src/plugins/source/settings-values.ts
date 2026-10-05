import type { JsonValue } from '../../document';

export const SETTING_TYPES = ['text', 'paragraph', 'color', 'number', 'toggle', 'choice'] as const;
export type SettingType = typeof SETTING_TYPES[number];

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
    default?: string | number | boolean;
    min?: number;
    max?: number;
    step?: number;
    /** Presentation only; hiding a field preserves its value and exported key. */
    showWhen?: { key: string; equals: string | number | boolean };
}

export interface SettingsData {
    fields: SettingsField[];
    values: Record<string, JsonValue>;
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
        default:
            return typeof value === 'string' ? value : '';
    }
}

export function constrainNumber(field: SettingsField, value: number): number {
    const min = Number.isFinite(field.min) ? field.min! : -Infinity;
    const max = Number.isFinite(field.max) ? field.max! : Infinity;
    return min <= max ? Math.min(max, Math.max(min, value)) : value;
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
