import { createRef, PureComponent } from 'react';
import {
    ModulePlugin,
    ModulePluginProps,
    HtmlData,
    CssData,
    JavascriptData,
    PlainTextData,
} from '../../document';
import { CodeEditor } from '../../ui/components/code-editor';
import { SPLIT_MARKER } from '../../util/split-html';
import { RichEditor } from '../../ui/components/rich-editor';
import { EditorView } from '@codemirror/view';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { stripTypes } from './script-runtime';
import { TextField } from '../../uikit/text-field';
import '../../uikit/controls.css';
import './text.css';
import { Select } from '../../uikit/select';

const HTML_CONTENTEDITABLE = 'html-contenteditable';

const LANGUAGES: { [k: string]: () => unknown[] } = {
    text: () => [EditorView.lineWrapping],
    html: () => [html(), EditorView.lineWrapping],
    css: () => [css()],
    javascript: () => [javascript()],
    typescript: () => [javascript({ typescript: true })],
    [HTML_CONTENTEDITABLE]: () => [html(), EditorView.lineWrapping],
};

const LANGUAGE_LABELS: { [k: string]: string } = {
    text: 'Plain Text',
    html: 'HTML',
    css: 'CSS',
    javascript: 'Javascript',
    typescript: 'TypeScript',
    [HTML_CONTENTEDITABLE]: 'Rich Text (HTML)',
};

export type TextPluginData = {
    contents: string;
    language: string;
    /** Optional author-provided writing instructions, saved with reusable groups. */
    help?: {
        summary: string;
        examples: { syntax: string; description: string }[];
    };
};

type WritingHelp = NonNullable<TextPluginData['help']>;

/**
 * Writing help for a text input in a block: what the writer sees under "Writing help". Block
 * authors edit it here; it is saved in the module data (and group files) and never published.
 */
function WritingHelpEditor({
    help,
    onChange,
}: {
    help: TextPluginData['help'];
    onChange: (help: TextPluginData['help']) => void;
}) {
    const value: WritingHelp = help ?? { summary: '', examples: [] };
    const set = (next: WritingHelp) =>
        onChange(next.summary.trim() || next.examples.length ? next : undefined);
    const setExample = (i: number, changes: Partial<WritingHelp['examples'][number]>) =>
        set({
            ...value,
            examples: value.examples.map((e, j) => (j === i ? { ...e, ...changes } : e)),
        });
    return (
        <details className="i-writing-help-editor">
            <summary>{help ? 'Edit writing help' : 'Add writing help for writers'}</summary>
            <label className="i-help-field">
                <span>What to write here</span>
                <textarea
                    className="uikit-text-area"
                    rows={2}
                    value={value.summary}
                    placeholder="e.g. Write one message per line."
                    onChange={(e) => set({ ...value, summary: e.target.value })}
                />
            </label>
            {value.examples.map((example, i) => (
                <div className="i-help-example" key={i}>
                    <label className="i-help-field">
                        <span>Example {i + 1}</span>
                        <TextField
                            value={example.syntax}
                            placeholder="Alex [09:41]: Hello"
                            onChange={(syntax) => setExample(i, { syntax })}
                        />
                    </label>
                    <label className="i-help-field">
                        <span>What it does</span>
                        <TextField
                            value={example.description}
                            placeholder="Speaker, optional time, and message."
                            onChange={(description) => setExample(i, { description })}
                        />
                    </label>
                    <button
                        type="button"
                        className="uikit-action"
                        aria-label={`Remove example ${i + 1}`}
                        onClick={() =>
                            set({ ...value, examples: value.examples.filter((_, j) => j !== i) })
                        }
                    >
                        Remove
                    </button>
                </div>
            ))}
            <button
                type="button"
                className="uikit-action"
                onClick={() =>
                    set({ ...value, examples: [...value.examples, { syntax: '', description: '' }] })
                }
            >
                + Add example
            </button>
        </details>
    );
}

class TextEditor extends PureComponent<ModulePluginProps<TextPluginData>> {
    state = {
        editingRichText: true,
    };

    memoizedExtensions: any = null;
    modeSelectId = Math.random().toString(36);
    codeEditor = createRef<CodeEditor>();
    richEditor = createRef<RichEditor>();

    /** Inserts the chapter-break marker at the cursor, in either editor. */
    insertSplitMarker = () => {
        if (this.richEditor.current) {
            this.richEditor.current.insertChapterBreak();
            return;
        }
        const view = this.codeEditor.current?.editor.current?.view;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const insert = `\n${SPLIT_MARKER}\n`;
        view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
        });
        view.focus();
    };

    get extensions() {
        if (!this.memoizedExtensions) {
            this.memoizedExtensions = LANGUAGES[this.props.data.language]();
        }
        return this.memoizedExtensions;
    }

    render() {
        const { data, onChange } = this.props;
        const setRichEditing = (next: boolean) => {
            if (next === this.state.editingRichText) return;
            if (!next) this.richEditor.current?.flush();
            this.setState({ editingRichText: next });
        };

        const footer = (
            <div className="i-footer i-text-footer">
                {data.language === HTML_CONTENTEDITABLE ? (
                    <span className="i-view-toggle" role="group" aria-label="Editor view">
                        <button
                            type="button"
                            className={this.state.editingRichText ? 'is-active' : undefined}
                            aria-pressed={this.state.editingRichText}
                            onClick={() => setRichEditing(true)}
                        >
                            Visual
                        </button>
                        <button
                            type="button"
                            className={!this.state.editingRichText ? 'is-active' : undefined}
                            aria-pressed={!this.state.editingRichText}
                            onClick={() => setRichEditing(false)}
                        >
                            HTML
                        </button>
                    </span>
                ) : null}
                {(data.language === 'html' || data.language === HTML_CONTENTEDITABLE) && (
                    <button
                        type="button"
                        className="i-footer-btn"
                        onClick={this.insertSplitMarker}
                        title="Marks where this chapter should be split in two. Then choose “Split at chapter break” in the chapter’s menu."
                    >
                        + Chapter break
                    </button>
                )}
                <span className="i-mode-control">
                    <label htmlFor={this.modeSelectId}>Mode: </label>
                    <Select
                        narrow
                        id={this.modeSelectId}
                        value={data.language}
                        onChange={(e) => {
                            const contents =
                                this.richEditor.current?.takeContent() ?? data.contents;
                            this.memoizedExtensions = null;
                            onChange({
                                ...data,
                                contents,
                                language: (e.target as HTMLSelectElement).value,
                            });
                        }}
                    >
                        {Object.keys(LANGUAGES).map((k) => (
                            <option key={k} value={k}>
                                {LANGUAGE_LABELS[k]}
                            </option>
                        ))}
                    </Select>
                </span>
            </div>
        );

        let editor;
        if (data.language === HTML_CONTENTEDITABLE && this.state.editingRichText) {
            editor = (
                <RichEditor
                    ref={this.richEditor}
                    value={data.contents}
                    onChange={(contents) => onChange({ ...data, contents })}
                    footer={footer}
                />
            );
        } else {
            editor = (
                <CodeEditor
                    ref={this.codeEditor}
                    value={data.contents}
                    onChange={(contents) => onChange({ ...data, contents })}
                    extensions={this.extensions}
                    footer={footer}
                />
            );
        }

        return (
            <div className="plugin-plain-text-editor">
                {data.help ? (
                    <details className="i-writing-help">
                        <summary>Writing help</summary>
                        <p>{data.help.summary}</p>
                        <dl>
                            {data.help.examples.map((example, i) => (
                                <div key={i}>
                                    <dt>
                                        <code>{example.syntax}</code>
                                    </dt>
                                    <dd>{example.description}</dd>
                                </div>
                            ))}
                        </dl>
                    </details>
                ) : null}
                {editor}
                {/* Block inputs are plain text; chapter text (rich text) needs no help editor. */}
                {data.help || data.language !== HTML_CONTENTEDITABLE ? (
                    <WritingHelpEditor
                        help={data.help}
                        onChange={(help) => {
                            const { help: _old, ...rest } = data;
                            onChange(help ? { ...rest, help } : rest);
                        }}
                    />
                ) : null}
            </div>
        );
    }
}

export default {
    id: 'source.text',
    acceptsInputs: false,
    acceptsNamedInputs: false,
    component: TextEditor as unknown, // typescript cant figure it out
    initialData(): TextPluginData {
        return { contents: '', language: 'text' };
    },
    description(data: TextPluginData) {
        if (data.language === 'html') return 'HTML';
        else if (data.language === 'css') return 'CSS';
        else if (data.language === 'javascript') return 'Javascript';
        else if (data.language === 'typescript') return 'TypeScript';
        else if (data.language === HTML_CONTENTEDITABLE) return 'HTML (Rich Text)';
        return 'Plain Text Data';
    },
    async eval(data: TextPluginData) {
        if (data.language === 'html' || data.language === HTML_CONTENTEDITABLE)
            return new HtmlData(data.contents);
        else if (data.language === 'css') return new CssData(data.contents);
        else if (data.language === 'javascript') return new JavascriptData(data.contents);
        else if (data.language === 'typescript')
            // Types are removed (not checked), so Svelte and scripts can import it as JavaScript.
            return new JavascriptData(await stripTypes(data.contents, { filePath: 'module.ts' }));
        return new PlainTextData(data.contents);
    },
} as ModulePlugin<TextPluginData>;
