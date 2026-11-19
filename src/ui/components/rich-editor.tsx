import React, { createRef, lazy, PureComponent, Suspense } from 'react';
import type { RichTextEditorHandle } from './tiptap-rich-editor';
import './rich-editor.css';

const TipTapRichEditor = lazy(() => import('./tiptap-rich-editor'));

export class RichEditor extends PureComponent<RichEditor.Props> {
    editor = createRef<RichTextEditorHandle>();

    onValueChange = (newValue: string) => {
        if (newValue === this.props.value) return;
        this.props.onChange(newValue);
    };

    insertChapterBreak() {
        this.editor.current?.insertChapterBreak();
    }

    flush() {
        this.editor.current?.flush();
    }

    takeContent(): string | undefined {
        if (!this.editor.current?.getEditor()) return undefined;
        const html = this.editor.current.getContent();
        this.editor.current.cancelPending();
        return html;
    }

    render() {
        const { value, footer, readOnly, placeholder } = this.props;

        return (
            <Suspense
                fallback={
                    <div className="tiptap-rich-editor is-loading">
                        <div className="i-editor-surface i-loading-placeholder">
                            Loading editor…
                        </div>
                        {footer ? <footer className="editor-footer">{footer}</footer> : null}
                    </div>
                }
            >
                <TipTapRichEditor
                    ref={this.editor}
                    value={value}
                    onChange={this.onValueChange}
                    disabled={readOnly}
                    placeholder={placeholder}
                    footer={footer}
                />
            </Suspense>
        );
    }
}

export namespace RichEditor {
    export interface Props {
        value: string;
        footer?: React.ReactNode;
        onChange: (v: string) => void;
        readOnly?: boolean;
        placeholder?: string;
    }
}
