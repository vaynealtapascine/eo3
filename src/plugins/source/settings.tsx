import { Fragment, useId } from 'react';
import { JavascriptData, JsonValue, ModulePlugin, ModulePluginProps } from '../../document';
import { TextField } from '../../uikit/text-field';
import Checkbox from '../../uikit/checkbox';
import {
    SETTING_TYPES,
    SettingsData,
    SettingsField,
    settingsModule,
    settingsValues,
    settingVisible,
    constrainNumber,
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
    describedBy,
}: {
    describedBy?: string;
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
                    aria-describedby={describedBy}
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
                    aria-describedby={describedBy}
                    type="color"
                    value={value as string}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        case 'number':
            return (
                <TextField
                    id={id}
                    aria-describedby={describedBy}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 'any'}
                    narrow
                    value={String(value)}
                    onChange={(v) => {
                        const number = v === '' ? 0 : Number(v);
                        if (Number.isFinite(number)) onChange(number);
                    }}
                    onBlur={() => onChange(constrainNumber(field, value as number))}
                />
            );
        case 'toggle':
            return (
                <Checkbox
                    id={id}
                    aria-describedby={describedBy}
                    checked={value as boolean}
                    onChange={onChange}
                />
            );
        case 'choice':
            return (
                <select
                    id={id}
                    aria-describedby={describedBy}
                    value={value as string}
                    onChange={(e) => onChange(e.target.value)}
                >
                    {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            );
        default:
            return (
                <TextField
                    id={id}
                    aria-describedby={describedBy}
                    value={value as string}
                    onChange={onChange}
                />
            );
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
    const values = settingsValues(data);
    const seen = new Set<string>();
    const fields = data.fields.filter((field) => {
        if (!field.key || seen.has(field.key)) return false;
        seen.add(field.key);
        return settingVisible(field, values);
    });
    const renderFields = (advanced: boolean) => {
        const sections = new Map<string, SettingsField[]>();
        for (const field of fields.filter((f) => !!f.advanced === advanced)) {
            const section = field.section?.trim() || '';
            sections.set(section, [...(sections.get(section) ?? []), field]);
        }
        return [...sections].map(([section, members]) => {
            const controls = members.map((field) => {
                const fieldId = `${id}-${data.fields.indexOf(field)}`;
                return (
                    <div className="i-setting" key={field.key}>
                        <label htmlFor={fieldId}>{field.label || field.key}</label>
                        <SettingInput
                            id={fieldId}
                            describedBy={field.hint ? `${fieldId}-hint` : undefined}
                            field={field}
                            value={
                                settingType(field) === 'number' &&
                                typeof data.values[field.key] === 'number' &&
                                Number.isFinite(data.values[field.key])
                                    ? data.values[field.key]
                                    : values[field.key]
                            }
                            onChange={(value) =>
                                onChange({
                                    ...data,
                                    values: { ...data.values, [field.key]: value },
                                })
                            }
                        />
                        {field.hint ? (
                            <div id={`${fieldId}-hint`} className="i-hint">
                                {field.hint}
                            </div>
                        ) : null}
                    </div>
                );
            });
            return section ? (
                <fieldset className="i-settings-section" key={section}>
                    <legend>{section}</legend>
                    {controls}
                </fieldset>
            ) : (
                <Fragment key="">{controls}</Fragment>
            );
        });
    };
    if (!fields.length) return <div className="i-empty">No settings to show.</div>;
    return (
        <div className="i-settings-form">
            {renderFields(false)}
            {fields.some((field) => field.advanced) ? (
                <details className="i-settings-advanced">
                    <summary>Advanced settings</summary>
                    <div className="i-settings-form">{renderFields(true)}</div>
                </details>
            ) : null}
        </div>
    );
}

/** Adding, renaming and removing fields: what someone building a block does. */
function FieldOptions({
    field,
    fields,
    onChange,
}: {
    field: SettingsField;
    fields: SettingsField[];
    onChange: (changes: Partial<SettingsField>) => void;
}) {
    const id = useId();
    const source = fields.find((f) => f.key === field.showWhen?.key);
    return (
        <details className="i-field-options">
            <summary>Options for {field.label || field.key || 'field'}</summary>
            <label>
                Help text
                <TextField value={field.hint ?? ''} onChange={(hint) => onChange({ hint })} />
            </label>
            <label>
                Section
                <TextField
                    value={field.section ?? ''}
                    placeholder="No section"
                    onChange={(section) => onChange({ section })}
                />
            </label>
            <label className="i-advanced-option">
                <Checkbox
                    checked={!!field.advanced}
                    onChange={(advanced) => onChange({ advanced })}
                />
                Show under Advanced settings
            </label>
            <label htmlFor={`${id}-default`}>Default value</label>
            <SettingInput
                id={`${id}-default`}
                field={field}
                value={settingValue(field, {})}
                onChange={(value) => onChange({ default: value as string | number | boolean })}
            />
            {settingType(field) === 'number'
                ? (['min', 'max', 'step'] as const).map((key) => (
                      <label key={key}>
                          {{ min: 'Minimum', max: 'Maximum', step: 'Step' }[key]}
                          <TextField
                              type="number"
                              value={field[key] === undefined ? '' : String(field[key])}
                              onChange={(v) => {
                                  if (!v || Number.isFinite(Number(v)))
                                      onChange({ [key]: v ? Number(v) : undefined });
                              }}
                          />
                      </label>
                  ))
                : null}
            <label>
                Show when
                <select
                    value={field.showWhen?.key ?? ''}
                    onChange={(e) => {
                        const control = fields.find((f) => f.key === e.target.value);
                        onChange({
                            showWhen: control
                                ? {
                                      key: control.key,
                                      equals: settingValue(control, {}) as
                                          | string
                                          | number
                                          | boolean,
                                  }
                                : undefined,
                        });
                    }}
                >
                    <option value="">Always</option>
                    {fields
                        .filter((f) => f.key && f.key !== field.key)
                        .map((f, i) => (
                            <option key={i} value={f.key}>
                                {f.label || f.key}
                            </option>
                        ))}
                </select>
            </label>
            {field.showWhen && source ? (
                <>
                    <label htmlFor={`${id}-equals`}>Equals</label>
                    <SettingInput
                        id={`${id}-equals`}
                        field={source}
                        value={field.showWhen.equals}
                        onChange={(value) =>
                            onChange({
                                showWhen: {
                                    key: source.key,
                                    equals: value as string | number | boolean,
                                },
                            })
                        }
                    />
                </>
            ) : field.showWhen ? (
                <p>The controlling field is missing. Choose another field or Always.</p>
            ) : null}
        </details>
    );
}

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
                        <Fragment key={i}>
                            <tr>
                                <td>
                                    <TextField
                                        aria-label="Name in code"
                                        narrow
                                        value={field.key}
                                        aria-invalid={!field.key || keys.indexOf(field.key) !== i}
                                        onChange={(key) => {
                                            if (!key || keys.includes(key)) {
                                                setField(i, { key });
                                                return;
                                            }
                                            const values = { ...data.values };
                                            if (Object.hasOwn(values, field.key)) {
                                                Object.defineProperty(values, key, {
                                                    value: values[field.key],
                                                    enumerable: true,
                                                    configurable: true,
                                                    writable: true,
                                                });
                                                delete values[field.key];
                                            }
                                            onChange({
                                                ...data,
                                                values,
                                                fields: data.fields.map((f, j) => ({
                                                    ...f,
                                                    ...(j === i ? { key } : {}),
                                                    ...(f.showWhen?.key === field.key
                                                        ? { showWhen: { ...f.showWhen, key } }
                                                        : {}),
                                                })),
                                            });
                                        }}
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
                            <tr>
                                <td colSpan={4}>
                                    <FieldOptions
                                        field={field}
                                        fields={data.fields}
                                        onChange={(changes) => setField(i, changes)}
                                    />
                                </td>
                            </tr>
                        </Fragment>
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
