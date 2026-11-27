import { PureComponent, useId } from 'react';
import { EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import {
    CssData,
    Data,
    EvalOptions,
    HtmlData,
    JavascriptData,
    ModulePlugin,
    ModulePluginProps,
    NamedInputData,
    PlainTextData,
    canonicalMime,
    textData,
} from '../../document';
import { CodeEditor } from '../../ui/components/code-editor';
import { SvelteComponentData } from './svelte-component';
import { SettingsModuleData, settingsTypeScript } from './settings-values';
import { buildScriptProgram, ScriptLanguage, ScriptModule } from './script-runtime';
import { runScript } from './script-sandbox';
import './script.css';

/** The output types offered by name; any other MIME type can be typed in. */
export const SCRIPT_OUTPUT_TYPES: { mime: string; label: string }[] = [
    { mime: 'text/css', label: 'CSS' },
    { mime: 'text/html', label: 'HTML' },
    { mime: 'application/javascript', label: 'JavaScript module' },
    { mime: 'svelte-component', label: 'Svelte component' },
    { mime: 'text/plain', label: 'Plain text' },
];

export type ScriptPluginData = {
    contents: string;
    language: ScriptLanguage;
    /** The MIME type the result is passed on as (`text/css`, `svelte-component`, …). */
    outputType: string;
    /** The component name, when the output is a Svelte component. */
    name?: string;
};

/** What the editor lists under "Inputs": each import and the type of its default export. */
type ScriptImports = { name: string; type: string }[];

function outputLabel(type: string): string {
    const mime = canonicalMime(type) ?? 'text/plain';
    return SCRIPT_OUTPUT_TYPES.find((t) => t.mime === mime)?.label ?? mime;
}

const STARTER = `// Send a Settings module here as a named input called "settings" to use its values:
// import settings from './settings';

export default function (): string {
    return \`.example {
    color: rebeccapurple;
}\`;
}
`;

function OutputControls({ data, onChange }: ModulePluginProps<ScriptPluginData>) {
    const id = useId();
    const mime = canonicalMime(data.outputType) ?? 'text/plain';
    const custom = !SCRIPT_OUTPUT_TYPES.some((t) => t.mime === mime);
    return (
        <>
            <span className="i-script-control">
                <label htmlFor={`${id}-language`}>Language: </label>
                <select
                    id={`${id}-language`}
                    value={data.language}
                    onChange={(e) =>
                        onChange({ ...data, language: e.target.value as ScriptLanguage })
                    }
                >
                    <option value="typescript">TypeScript</option>
                    <option value="javascript">JavaScript</option>
                </select>
            </span>
            <span className="i-script-control">
                <label htmlFor={`${id}-output`}>Output as: </label>
                <select
                    id={`${id}-output`}
                    value={custom ? '' : mime}
                    onChange={(e) =>
                        onChange({
                            ...data,
                            outputType: e.target.value || 'text/markdown',
                        })
                    }
                >
                    {SCRIPT_OUTPUT_TYPES.map((t) => (
                        <option key={t.mime} value={t.mime}>
                            {t.label}
                        </option>
                    ))}
                    <option value="">Other MIME type…</option>
                </select>
            </span>
            {custom ? (
                <span className="i-script-control">
                    <label htmlFor={`${id}-mime`}>MIME type: </label>
                    <input
                        id={`${id}-mime`}
                        value={data.outputType}
                        spellCheck={false}
                        onChange={(e) => onChange({ ...data, outputType: e.target.value })}
                    />
                </span>
            ) : null}
            {mime === 'svelte-component' ? (
                <span className="i-script-control">
                    <label htmlFor={`${id}-name`}>Component name: </label>
                    <input
                        id={`${id}-name`}
                        value={data.name ?? ''}
                        placeholder="Component"
                        onChange={(e) => onChange({ ...data, name: e.target.value })}
                    />
                </span>
            ) : null}
        </>
    );
}

class ScriptEditor extends PureComponent<ModulePluginProps<ScriptPluginData>> {
    memoizedExtensions: unknown[] | null = null;
    memoizedLanguage: string | null = null;

    get extensions() {
        if (!this.memoizedExtensions || this.memoizedLanguage !== this.props.data.language) {
            this.memoizedLanguage = this.props.data.language;
            this.memoizedExtensions = [
                javascript({ typescript: this.props.data.language === 'typescript' }),
                EditorView.lineWrapping,
            ];
        }
        return this.memoizedExtensions;
    }

    render() {
        const { data, onChange, userData } = this.props;
        const imports = userData.imports as ScriptImports | undefined;
        const footer = (
            <div className="i-footer i-script-footer">
                <OutputControls {...this.props} />
            </div>
        );
        return (
            <div className="plugin-script-editor">
                <CodeEditor
                    value={data.contents}
                    onChange={(contents) => onChange({ ...data, contents })}
                    extensions={this.extensions}
                    footer={footer}
                />
                <details className="i-script-inputs">
                    <summary>Inputs and how to use them</summary>
                    <p>
                        The default export is the output: text, or a function (it may be{' '}
                        <code>async</code>) that returns it. Modules sent here as named inputs can
                        be imported as <code>./&lt;name&gt;</code>, and are also passed to that
                        function by name. Types are removed, not checked. Scripts run in a sandbox,
                        with no access to eo3 or your library, and are stopped after 5 seconds.
                    </p>
                    {imports?.length ? (
                        <ul>
                            {imports.map(({ name, type }) => (
                                <li key={name}>
                                    <pre>
                                        <code>
                                            {`import ${identifier(name)} from ${JSON.stringify(
                                                './' + name
                                            )};\n// ${identifier(name)}: ${type.replace(
                                                /\n/g,
                                                '\n// '
                                            )}`}
                                        </code>
                                    </pre>
                                </li>
                            ))}
                        </ul>
                    ) : imports ? (
                        <p>Nothing is sent to this script yet.</p>
                    ) : (
                        <p>This script hasn’t run yet, so its inputs aren’t known.</p>
                    )}
                </details>
            </div>
        );
    }
}

/** A variable name for an input, for the import examples. */
function identifier(name: string): string {
    const id = name
        .replace(/\.[^.]*$/, '')
        .replace(/[^\w$]+(.)?/g, (_, c) => (c ?? '').toUpperCase());
    return /^[A-Za-z_$]/.test(id) ? id : `_${id}`;
}

/** A named input as an importable module, with the type its default export has. */
function inputModule(name: string, value: Data): { module: ScriptModule; type: string } {
    if (value instanceof SettingsModuleData) {
        return { module: { code: value.contents }, type: settingsTypeScript(value.fields) };
    }
    const js = value.into(JavascriptData);
    if (js) return { module: { code: js.contents }, type: 'a JavaScript module' };
    const text = value.into(PlainTextData);
    if (text) {
        const kind =
            value instanceof CssData
                ? ' (CSS)'
                : value instanceof HtmlData
                ? ' (HTML)'
                : value instanceof SvelteComponentData
                ? ' (Svelte)'
                : text.typeId !== 'text/plain'
                ? ` (${text.typeId})`
                : '';
        return {
            module: { code: `export default ${JSON.stringify(text.contents)};` },
            type: `string${kind}`,
        };
    }
    throw new Error(`Can’t pass input “${name}” to a script: it is ${value.typeDescription()}.`);
}

/** The script's result as data of its output type. */
export function scriptOutput(
    data: ScriptPluginData,
    result:
        | { kind: 'text'; value: string }
        | { kind: 'json'; value: string; valueType: string }
        | { kind: 'undefined' }
): Data {
    const mime = canonicalMime(data.outputType) ?? 'text/plain';
    if (result.kind === 'text') {
        if (mime === 'svelte-component') {
            return new SvelteComponentData(data.name?.trim() || 'Component', result.value);
        }
        return textData(mime, result.value);
    }
    if (result.kind === 'json' && mime === 'application/javascript') {
        // Data for Svelte or another script: `import data from './name'`.
        return new JavascriptData(`export default ${result.value};\n`);
    }
    const got =
        result.kind === 'undefined'
            ? 'nothing'
            : result.valueType === 'null'
            ? 'null'
            : `${/^[aeiou]/.test(result.valueType) ? 'an' : 'a'} ${result.valueType}`;
    throw new Error(
        `The script returned ${got}, but should return text (${outputLabel(mime)}). ` +
            (mime === 'application/javascript'
                ? ''
                : 'To pass data on instead, choose “Output as: JavaScript module”.')
    );
}

/**
 * TypeScript or JavaScript that generates text of a chosen type (CSS, HTML, JavaScript, a Svelte
 * component, or any MIME type) from the modules sent to it, such as a Settings form.
 */
export default {
    id: 'source.script',
    acceptsInputs: false,
    acceptsNamedInputs: true,
    wantsDebounce: true,
    component: ScriptEditor as unknown, // typescript cant figure it out
    initialData(): ScriptPluginData {
        return { contents: STARTER, language: 'typescript', outputType: 'text/css' };
    },
    description(data: ScriptPluginData) {
        const language = data.language === 'javascript' ? 'JavaScript' : 'TypeScript';
        return `${language} → ${outputLabel(data.outputType)}`;
    },
    async eval(
        data: ScriptPluginData,
        _inputs: Data[],
        namedInputs: NamedInputData,
        { userData }: EvalOptions
    ) {
        const modules = new Map<string, ScriptModule>();
        const imports: ScriptImports = [];
        for (const [name, value] of namedInputs) {
            const { module, type } = inputModule(name, value);
            modules.set(name, module);
            imports.push({ name, type });
        }
        userData.imports = imports;

        const program = await buildScriptProgram(
            { code: data.contents, language: data.language },
            modules
        );
        const result = await runScript(program);
        if (!result.ok) {
            const error = new Error(result.error);
            if (result.stack)
                (error as Error & { scriptStack?: string }).scriptStack = result.stack;
            throw error;
        }
        return scriptOutput(data, result);
    },
} as ModulePlugin<ScriptPluginData>;
