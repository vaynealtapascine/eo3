import { useId } from 'react';
import { JavascriptData, JsonValue, ModulePlugin, ModulePluginProps } from '../../document';
import { TextField } from '../../uikit/text-field';
import Checkbox from '../../uikit/checkbox';
import {
    SETTING_TYPES,
    SettingsData,
    SettingsField,
    settingsModule,
    settingType,
    settingValue,
} from './settings-values';
import './settings.css';

const TYPE_LABELS: Record<typeof SETTING_TYPES[number], string> = {
    text: 'Short text',
    paragraph: 'Paragraph',
    color: 'Color',
    number: 'Number',
    toggle: 'On/off',
    choice: 'Choice',
};

function SettingInput({
    field,
    value,
    id,
    onChange,
}: {
    field: SettingsField;
    value: JsonValue;
    id: string;
    onChange: (value: JsonValue) => void;
}) {
    switch (settingType(field)) {
        case 'paragraph':
            return (
                <textarea
                    id={id}
                    className="i-paragraph"
                    rows={3}
                    value={value as string}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        case 'color':
            return (
                <input
                    id={id}
                    type="color"
                    value={value as string}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        case 'number':
            return (
                <TextField
                    id={id}
                    type="number"
                    narrow
                    value={String(value)}
                    onChange={(v) => onChange(v === '' ? 0 : Number(v))}
                />
            );
        case 'toggle':
            return <Checkbox id={id} checked={value as boolean} onChange={onChange} />;
        case 'choice':
            return (
                <select id={id} value={value as string} onChange={(e) => onChange(e.target.value)}>
                    {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            );
        default:
            return <TextField id={id} value={value as string} onChange={onChange} />;
    }
}

/** The form a writer fills in. */
export function SettingsForm({
    data,
    onChange,
}: {
    data: SettingsData;
    onChange: (data: SettingsData) => void;
}) {
    const id = useId();
    if (!data.fields.length) {
        return <div className="i-empty">No settings yet.</div>;
    }
    return (
        <div className="i-settings-form">
            {data.fields.map((field, i) =>
                field.key ? (
                    <div className="i-setting" key={i}>
                        <label htmlFor={`${id}-${i}`}>{field.label || field.key}</label>
                        <SettingInput
                            id={`${id}-${i}`}
                            field={field}
                            value={settingValue(field, data.values)}
                            onChange={(value) =>
                                onChange({
                                    ...data,
                                    values: { ...data.values, [field.key]: value },
                                })
                            }
                        />
                        {field.hint ? <div className="i-hint">{field.hint}</div> : null}
                    </div>
                ) : null
            )}
        </div>
    );
}

/** Adding, renaming and removing fields: what someone building a block does. */
function FieldsEditor({ data, onChange }: ModulePluginProps<SettingsData>) {
    const setField = (i: number, changes: Partial<SettingsField>) => {
        const fields = data.fields.slice();
        fields[i] = { ...fields[i], ...changes };
        onChange({ ...data, fields });
    };
    const keys = data.fields.map((field) => field.key);
    return (
        <details className="i-fields-editor">
            <summary>Fields ({data.fields.length})</summary>
            <table>
                <thead>
                    <tr>
                        <th>Name in code</th>
                        <th>Label</th>
                        <th>Type</th>
                        <th>
                            <span hidden>Remove</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {data.fields.map((field, i) => (
                        <tr key={i}>
                            <td>
                                <TextField
                                    aria-label="Name in code"
                                    narrow
                                    value={field.key}
                                    aria-invalid={!field.key || keys.indexOf(field.key) !== i}
                                    onChange={(key) => setField(i, { key })}
                                />
                            </td>
                            <td>
                                <TextField
                                    aria-label="Label"
                                    narrow
                                    value={field.label ?? ''}
                                    placeholder={field.key}
                                    onChange={(label) => setField(i, { label })}
                                />
                                {settingType(field) === 'choice' ? (
                                    <TextField
                                        aria-label="Choices, separated by commas"
                                        narrow
                                        placeholder="choices, comma separated"
                                        value={(field.options ?? []).join(', ')}
                                        onChange={(v) =>
                                            setField(i, {
                                                options: v
                                                    .split(',')
                                                    .map((s) => s.trim())
                                                    .filter(Boolean),
                                            })
                                        }
                                    />
                                ) : null}
                            </td>
                            <td>
                                <select
                                    aria-label="Type"
                                    value={settingType(field)}
                                    onChange={(e) =>
                                        setField(i, {
                                            type: e.target.value as SettingsField['type'],
                                        })
                                    }
                                >
                                    {SETTING_TYPES.map((type) => (
                                        <option key={type} value={type}>
                                            {TYPE_LABELS[type]}
                                        </option>
                                    ))}
                                </select>
                            </td>
                            <td>
                                <button
                                    className="i-remove-field"
                                    aria-label={`remove ${field.label || field.key || 'field'}`}
                                    onClick={() =>
                                        onChange({
                                            ...data,
                                            fields: data.fields.filter((_, j) => j !== i),
                                        })
                                    }
                                >
                                    ×
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <button
                className="i-add-field"
                onClick={() => {
                    let n = data.fields.length + 1;
                    while (keys.includes(`field${n}`)) n++;
                    onChange({ ...data, fields: [...data.fields, { key: `field${n}` }] });
                }}
            >
                add field
            </button>
            <p className="i-hint">
                Send this module to a Svelte module as a named input (say, <code>settings</code>
                ), then read the values with <code>import settings from './settings'</code>.
            </p>
        </details>
    );
}

function SettingsEditor(props: ModulePluginProps<SettingsData>) {
    return (
        <div className="plugin-settings-editor">
            <SettingsForm data={props.data} onChange={props.onChange} />
            <FieldsEditor {...props} />
        </div>
    );
}

/**
 * A form of named values (text, colors, choices…), passed on as a JavaScript module whose
 * default export holds them. Blocks in the simple editor show it as their settings.
 */
export default {
    id: 'source.settings',
    acceptsInputs: false,
    acceptsNamedInputs: false,
    component: SettingsEditor,
    initialData(): SettingsData {
        return { fields: [], values: {} };
    },
    description() {
        return 'Settings';
    },
    async eval(data) {
        return new JavascriptData(settingsModule(data));
    },
} as ModulePlugin<SettingsData>;
