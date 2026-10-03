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
    const value = values[field.key];
    switch (settingType(field)) {
        case 'toggle':
            return typeof value === 'boolean' ? value : false;
        case 'number':
            return typeof value === 'number' && isFinite(value) ? value : 0;
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

/** Every field's value by key, in field order; fields without a key are skipped. */
export function settingsValues(data: SettingsData): Record<string, JsonValue> {
    const result: Record<string, JsonValue> = {};
    for (const field of data.fields) {
        if (field.key && !Object.hasOwn(result, field.key)) {
            result[field.key] = settingValue(field, data.values);
        }
    }
    return result;
}

/** The module a Settings module evaluates to: `import settings from './settings'`. */
export function settingsModule(data: SettingsData): string {
    return `export default ${JSON.stringify(settingsValues(data), null, 2)};\n`;
}
