import React, { createRef, lazy, PureComponent, Suspense } from 'react';
import type { PopoverAnchor, RichTextAutoFocus, RichTextEditorHandle } from './tiptap-rich-editor';
import type { CssPiece } from '../../editor/css-pieces';
import { EditorCanvasContext } from '../editor-canvas-context';
import './rich-editor.css';

const TipTapRichEditor = lazy(() => import('./tiptap-rich-editor'));

export class RichEditor extends PureComponent<RichEditor.Props> {
    static contextType = EditorCanvasContext;
    declare context: React.ContextType<typeof EditorCanvasContext>;

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

    focus() {
        this.editor.current?.focus();
    }

    openStyles(anchor: PopoverAnchor) {
        this.editor.current?.openStyles(anchor);
    }

    openFormat(anchor: PopoverAnchor) {
        this.editor.current?.openFormat(anchor);
    }

    splitAtSelection(): { before: string; after: string } | null {
        return this.editor.current?.splitAtSelection() ?? null;
    }

    isEmpty(): boolean {
        return this.editor.current?.isEmpty() ?? true;
    }

    takeContent(): string | undefined {
        if (!this.editor.current?.getEditor()) return undefined;
        const html = this.editor.current.getContent();
        this.editor.current.cancelPending();
        return html;
    }

    render() {
        const {
            value,
            footer,
            readOnly,
            placeholder,
            className,
            variant,
            onFocus,
            canvasCss,
            onEnsurePieceCss,
            onKeyDown,
            autoFocus,
        } = this.props;
        const effectiveCss = canvasCss ?? this.context?.canvasCss ?? '';
        const effectiveEnsurePieceCss = onEnsurePieceCss ?? this.context?.ensurePieceCss;

        return (
            <Suspense
                fallback={
                    <div
                        className={
                            'tiptap-rich-editor is-loading' +
                            (variant === 'inline' ? ' is-inline' : '') +
                            (className ? ' ' + className : '')
                        }
                    >
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
                    onFocus={onFocus}
                    disabled={readOnly}
                    placeholder={placeholder}
                    className={className}
                    variant={variant}
                    footer={footer}
                    canvasCss={effectiveCss}
                    onEnsurePieceCss={effectiveEnsurePieceCss}
                    onKeyDown={onKeyDown}
                    autoFocus={autoFocus}
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
        onFocus?: () => void;
        readOnly?: boolean;
        placeholder?: string;
        className?: string;
        variant?: 'card' | 'inline';
        canvasCss?: string;
        onEnsurePieceCss?: (piece: CssPiece) => void | Promise<unknown>;
        /** Runs before the editor's own key handling; return true to take the key. */
        onKeyDown?: (event: KeyboardEvent) => boolean;
        /** Focuses the editor once it exists: at the start, the end, or the point clicked. */
        autoFocus?: RichTextAutoFocus;
    }
}
