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
import './text.css';

const HTML_CONTENTEDITABLE = 'html-contenteditable';

const LANGUAGES: { [k: string]: () => unknown[] } = {
    text: () => [EditorView.lineWrapping],
    html: () => [html(), EditorView.lineWrapping],
    css: () => [css()],
    javascript: () => [javascript()],
    [HTML_CONTENTEDITABLE]: () => [html(), EditorView.lineWrapping],
};

const LANGUAGE_LABELS: { [k: string]: string } = {
    text: 'Plain Text',
    html: 'HTML',
    css: 'CSS',
    javascript: 'Javascript',
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
                    <select
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
                    </select>
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
        else if (data.language === HTML_CONTENTEDITABLE) return 'HTML (Rich Text)';
        return 'Plain Text Data';
    },
    async eval(data: TextPluginData) {
        if (data.language === 'html' || data.language === HTML_CONTENTEDITABLE)
            return new HtmlData(data.contents);
        else if (data.language === 'css') return new CssData(data.contents);
        else if (data.language === 'javascript') return new JavascriptData(data.contents);
        return new PlainTextData(data.contents);
    },
} as ModulePlugin<TextPluginData>;
