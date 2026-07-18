import React, { createRef, PureComponent } from 'react';
import TinyRTE, { RichTextEditorHandle } from './tiny-rich-editor';
import './rich-editor.css';

export class RichEditor extends PureComponent<RichEditor.Props> {
    editor = createRef<RichTextEditorHandle>();

    onValueChange = (newValue: string) => {
        if (newValue === this.props.value) return;
        this.props.onChange(newValue);
    };

    render() {
        const { value, footer, readOnly, placeholder, height } = this.props;

        return (
            <div className="tmce-rich-editor">
                <TinyRTE
                    ref={this.editor}
                    value={value}
                    onChange={this.onValueChange}
                    disabled={readOnly}
                    placeholder={placeholder}
                    height={height}
                />
                <footer className="editor-footer">{footer}</footer>
            </div>
        );
    }
}
namespace RichEditor {
    export interface Props {
        value: string;
        footer?: React.ReactNode;
        onChange: (v: string) => void;
        readOnly?: boolean;
        placeholder?: string;
        height?: number | string;
    }
}
