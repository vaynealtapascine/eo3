import { Fragment, useId, useState } from 'react';
import { javascript } from '@codemirror/lang-javascript';
import { JsonValue, ModulePlugin, ModulePluginProps } from '../../document';
import { TextField } from '../../uikit/text-field';
import Checkbox from '../../uikit/checkbox';
import { CodeEditor } from '../../ui/components/code-editor';
import {
    SETTING_TYPES,
    ListItem,
    SettingDefault,
    SettingsData,
    SettingsField,
    SettingsModuleData,
    settingsValues,
    settingVisible,
    constrainNumber,
    settingType,
    settingValue,
    itemFields,
    listBounds,
    listItemValue,
    parseSettingsFields,
} from './settings-values';
import { buildScriptProgram } from './script-runtime';
import { runScript } from './script-sandbox';
import './settings.css';

const TYPE_LABELS: Record<typeof SETTING_TYPES[number], string> = {
    text: 'Short text',
    paragraph: 'Paragraph',
    color: 'Color',
    number: 'Number',
    toggle: 'On/off',
    choice: 'Choice',
    list: 'List (writers add entries)',
};

function SettingInput({
    field,
    value,
    raw,
    id,
    onChange,
    describedBy,
}: {
    describedBy?: string;
    field: SettingsField;
    value: JsonValue;
    /** The saved value before it was normalized (numbers being typed, list entries). */
    raw?: JsonValue;
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
        case 'number': {
            const shown = typeof raw === 'number' && Number.isFinite(raw) ? raw : value;
            return (
                <TextField
                    id={id}
                    aria-describedby={describedBy}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 'any'}
                    narrow
                    value={String(shown)}
                    onChange={(v) => {
                        const number = v === '' ? 0 : Number(v);
                        if (Number.isFinite(number)) onChange(number);
                    }}
                    onBlur={() => onChange(constrainNumber(field, shown as number))}
                />
            );
        }
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
        case 'list':
            return (
                <ListInput
                    id={id}
                    describedBy={describedBy}
                    field={field}
                    items={value as ListItem[]}
                    raw={raw}
                    onChange={onChange}
                />
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

/** A list the writer grows: one group of the item fields per entry, with add/move/remove. */
function ListInput({
    field,
    items,
    raw,
    id,
    describedBy,
    onChange,
}: {
    field: SettingsField;
    items: ListItem[];
    raw?: JsonValue;
    id: string;
    describedBy?: string;
    onChange: (items: ListItem[]) => void;
}) {
    const fields = itemFields(field);
    const { min, max } = listBounds(field);
    const label = field.itemLabel?.trim() || 'Item';
    const rawItems = Array.isArray(raw) ? raw : [];
    const move = (from: number, to: number) => {
        const next = items.slice();
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        onChange(next);
    };
    return (
        <div className="i-list" id={id} role="group" aria-describedby={describedBy}>
            {items.map((item, i) => {
                const rawItem = rawItems[i];
                const visible = fields.filter((f) => settingVisible(f, item));
                return (
                    <fieldset className="i-list-item" key={i}>
                        <legend>
                            {label} {i + 1}
                        </legend>
                        {visible.length ? (
                            visible.map((f) => {
                                const fieldId = `${id}-${i}-${fields.indexOf(f)}`;
                                return (
                                    <div className="i-setting" key={f.key}>
                                        <label htmlFor={fieldId}>{f.label || f.key}</label>
                                        <SettingInput
                                            id={fieldId}
                                            describedBy={f.hint ? `${fieldId}-hint` : undefined}
                                            field={f}
                                            value={item[f.key]}
                                            raw={
                                                rawItem &&
                                                typeof rawItem === 'object' &&
                                                !Array.isArray(rawItem) &&
                                                Object.hasOwn(rawItem, f.key)
                                                    ? rawItem[f.key]
                                                    : undefined
                                            }
                                            onChange={(value) => {
                                                const next = items.slice();
                                                next[i] = { ...item, [f.key]: value };
                                                onChange(next);
                                            }}
                                        />
                                        {f.hint ? (
                                            <div id={`${fieldId}-hint`} className="i-hint">
                                                {f.hint}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="i-hint">This list has no fields yet.</div>
                        )}
                        <div className="i-list-item-actions">
                            <button
                                type="button"
                                disabled={i === 0}
                                aria-label={`Move ${label} ${i + 1} up`}
                                onClick={() => move(i, i - 1)}
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                disabled={i === items.length - 1}
                                aria-label={`Move ${label} ${i + 1} down`}
                                onClick={() => move(i, i + 1)}
                            >
                                ↓
                            </button>
                            <button
                                type="button"
                                disabled={items.length <= min}
                                onClick={() => onChange(items.filter((_, j) => j !== i))}
                            >
                                Remove
                            </button>
                        </div>
                    </fieldset>
                );
            })}
            <button
                type="button"
                className="i-list-add"
                disabled={items.length >= max}
                onClick={() => onChange([...items, listItemValue(fields, {})])}
            >
                + Add {label.toLowerCase()}
            </button>
        </div>
    );
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
                const isList = settingType(field) === 'list';
                return (
                    <div className={isList ? 'i-setting i-setting-list' : 'i-setting'} key={field.key}>
                        <label htmlFor={fieldId}>{field.label || field.key}</label>
                        <SettingInput
                            id={fieldId}
                            describedBy={field.hint ? `${fieldId}-hint` : undefined}
                            field={field}
                            value={values[field.key]}
                            raw={
                                Object.hasOwn(data.values, field.key)
                                    ? data.values[field.key]
                                    : undefined
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
    const isList = settingType(field) === 'list';
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
            {isList ? (
                <>
                    <label>
                        One entry is called
                        <TextField
                            value={field.itemLabel ?? ''}
                            placeholder="Item"
                            onChange={(itemLabel) => onChange({ itemLabel })}
                        />
                    </label>
                    {(['minItems', 'maxItems'] as const).map((key) => (
                        <label key={key}>
                            {{ minItems: 'At least (entries)', maxItems: 'At most (entries)' }[key]}
                            <TextField
                                type="number"
                                min={0}
                                step={1}
                                value={field[key] === undefined ? '' : String(field[key])}
                                onChange={(v) => {
                                    if (!v || Number.isFinite(Number(v)))
                                        onChange({ [key]: v ? Number(v) : undefined });
                                }}
                            />
                        </label>
                    ))}
                    <div className="i-list-fields">
                        <div className="i-list-fields-title">Each entry has</div>
                        <FieldsTable
                            fields={field.fields ?? []}
                            onChange={(itemFields) => onChange({ fields: itemFields })}
                        />
                    </div>
                </>
            ) : null}
            <label htmlFor={`${id}-default`}>{isList ? 'Starting entries' : 'Default value'}</label>
            <SettingInput
                id={`${id}-default`}
                field={field}
                value={settingValue(field, {})}
                onChange={(value) => onChange({ default: value as SettingDefault })}
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
                        .filter(
                            (f) => f.key && f.key !== field.key && settingType(f) !== 'list'
                        )
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

/**
 * The fields of a form (or of one entry of a list field): key, label, type, options. A rename
 * is reported so the caller can move saved values to the new key.
 */
function FieldsTable({
    fields,
    onChange,
}: {
    fields: SettingsField[];
    onChange: (fields: SettingsField[], rename?: { from: string; to: string }) => void;
}) {
    const setField = (i: number, changes: Partial<SettingsField>) => {
        const next = fields.slice();
        next[i] = { ...next[i], ...changes };
        onChange(next);
    };
    const keys = fields.map((field) => field.key);
    return (
        <>
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
                    {fields.map((field, i) => (
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
                                            onChange(
                                                fields.map((f, j) => ({
                                                    ...f,
                                                    ...(j === i ? { key } : {}),
                                                    ...(f.showWhen?.key === field.key
                                                        ? { showWhen: { ...f.showWhen, key } }
                                                        : {}),
                                                })),
                                                { from: field.key, to: key }
                                            );
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
                                        <ChoicesField
                                            options={field.options ?? []}
                                            onChange={(options) => setField(i, { options })}
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
                                        onClick={() => onChange(fields.filter((_, j) => j !== i))}
                                    >
                                        ×
                                    </button>
                                </td>
                            </tr>
                            <tr>
                                <td colSpan={4}>
                                    <FieldOptions
                                        field={field}
                                        fields={fields}
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
                    let n = fields.length + 1;
                    while (keys.includes(`field${n}`)) n++;
                    onChange([...fields, { key: `field${n}` }]);
                }}
            >
                add field
            </button>
        </>
    );
}

/** A choice field's options as one comma-separated line. */
export function parseChoices(text: string): string[] {
    return [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))];
}

/**
 * Choices typed as "a, b, c". What's typed is kept as typed while the field has focus, so a
 * trailing comma or space survives until the next choice is typed; on blur it is tidied.
 */
export function ChoicesField({
    options,
    onChange,
}: {
    options: string[];
    onChange: (options: string[]) => void;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <TextField
            aria-label="Choices, separated by commas"
            narrow
            placeholder="choices, comma separated"
            value={draft ?? options.join(', ')}
            onChange={(text) => {
                setDraft(text);
                onChange(parseChoices(text));
            }}
            onBlur={() => setDraft(null)}
        />
    );
}

/** Moves a saved value to a renamed key. */
function renameValue(values: SettingsData['values'], from: string, to: string) {
    const next = { ...values };
    if (Object.hasOwn(next, from)) {
        Object.defineProperty(next, to, {
            value: next[from],
            enumerable: true,
            configurable: true,
            writable: true,
        });
        delete next[from];
    }
    return next;
}

function fieldsCodeTemplate(fields: SettingsField[]): string {
    return `// The form's fields. "Apply" runs this and replaces the fields above.
// Types: text, paragraph, color, number, toggle, choice, list.
// A list field has its own \`fields\`, which each entry a writer adds gets.
type Field = {
    key: string;
    label?: string;
    type?: 'text' | 'paragraph' | 'color' | 'number' | 'toggle' | 'choice' | 'list';
    [option: string]: unknown;
};

const fields: Field[] = ${JSON.stringify(fields, null, 4)};

export default fields;
`;
}

/** Fields written as TypeScript or JavaScript, run in the script sandbox on Apply. */
function FieldsCode({ data, onChange }: ModulePluginProps<SettingsData>) {
    const [code, setCode] = useState(() => data.fieldsCode ?? fieldsCodeTemplate(data.fields));
    const [status, setStatus] = useState<{ error?: string; applied?: boolean; running?: boolean }>(
        {}
    );
    const [extensions] = useState(() => [javascript({ typescript: true })]);
    const apply = async () => {
        setStatus({ running: true });
        try {
            const program = await buildScriptProgram(
                { code, language: 'typescript' },
                new Map()
            );
            const result = await runScript(program);
            if (!result.ok) throw new Error(result.error);
            if (result.kind !== 'json') {
                throw new Error(
                    'The default export should be a list of fields (or a function returning one).'
                );
            }
            const fields = parseSettingsFields(JSON.parse(result.value));
            onChange({ ...data, fields, fieldsCode: code });
            setStatus({ applied: true });
        } catch (err) {
            setStatus({ error: err instanceof Error ? err.message : String(err) });
        }
    };
    return (
        <details className="i-fields-code">
            <summary>Write the fields as code</summary>
            <p className="i-hint">
                TypeScript or JavaScript whose default export is the list of fields, or a function
                that returns it, so you can build fields with loops. <b>Apply</b> runs it in a
                sandbox and replaces the fields above; what writers entered is kept.
            </p>
            <CodeEditor
                value={code}
                onChange={(next) => {
                    setCode(next);
                    if (status.applied || status.error) setStatus({});
                }}
                extensions={extensions}
            />
            <div className="i-fields-code-actions">
                <button type="button" onClick={apply} disabled={status.running}>
                    {status.running ? 'Running…' : 'Apply'}
                </button>
                {status.applied ? <span role="status">Fields updated.</span> : null}
            </div>
            {status.error ? (
                <pre className="i-fields-code-error" role="alert">
                    {status.error}
                </pre>
            ) : null}
        </details>
    );
}

function FieldsEditor(props: ModulePluginProps<SettingsData>) {
    const { data, onChange } = props;
    return (
        <details className="i-fields-editor">
            <summary>Fields ({data.fields.length})</summary>
            <FieldsTable
                fields={data.fields}
                onChange={(fields, rename) =>
                    onChange({
                        ...data,
                        fields,
                        values: rename ? renameValue(data.values, rename.from, rename.to) : data.values,
                    })
                }
            />
            <FieldsCode {...props} />
            <p className="i-hint">
                Send this module to a Svelte or Script module as a named input (say,{' '}
                <code>settings</code>), then read the values with{' '}
                <code>import settings from './settings'</code>.
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
 * A form of named values (text, colors, choices, lists…), passed on as a JavaScript module whose
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
        return new SettingsModuleData(data);
    },
} as ModulePlugin<SettingsData>;
