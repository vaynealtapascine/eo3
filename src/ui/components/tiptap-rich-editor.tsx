import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/core';
import { createEo3Extensions } from '../../editor/extensions';
import { editorContentToHtml, htmlToEditorContent } from '../../editor/html-sync';
import type { RubyAttrs } from '../../editor/ruby';
import type { TextDirection } from '../../editor/ao3-attributes';
import { DirPopover } from '../../uikit/dir-popover';
import { useFocusWhenShown } from '../focus-when-shown';

const SYNC_DEBOUNCE_MS = 200;

const COLOR_PRESETS = [
    '#000000',
    '#555555',
    '#870000',
    '#c62828',
    '#d84315',
    '#ef6c00',
    '#2e7d32',
    '#00695c',
    '#1565c0',
    '#4527a0',
    '#6a1b9a',
    '#ffffff',
];

const HIGHLIGHT_PRESETS = [
    '#fff59d',
    '#ffcc80',
    '#ffab91',
    '#f48fb1',
    '#ce93d8',
    '#90caf9',
    '#80deea',
    '#a5d6a7',
    '#e0e0e0',
];

export interface RichTextEditorProps {
    value?: string;
    initialValue?: string;
    onChange?: (content: string) => void;
    onBlur?: () => void;
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    footer?: React.ReactNode;
}

export interface RichTextEditorHandle {
    getEditor: () => Editor | null;
    getContent: () => string;
    setContent: (content: string) => void;
    insertChapterBreak: () => void;
    flush: () => void;
    cancelPending: () => void;
    focus: () => void;
}

function getSelectedRuby(editor: Editor): RubyAttrs | null {
    const { selection } = editor.state;
    if ('node' in selection && selection.node) {
        const node = selection.node as { type?: { name?: string }; attrs?: Partial<RubyAttrs> };
        if (node.type?.name === 'ruby') {
            return {
                base: String(node.attrs?.base ?? ''),
                ruby: String(node.attrs?.ruby ?? ''),
                useRp: node.attrs?.useRp !== false,
            };
        }
    }
    return null;
}

function isSafeUrl(url: string, allowRelative: boolean): boolean {
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (allowRelative && (trimmed.startsWith('#') || trimmed.startsWith('/'))) return true;
    try {
        const parsed = new URL(trimmed);
        return (
            parsed.protocol === 'http:' ||
            parsed.protocol === 'https:' ||
            (allowRelative && (parsed.protocol === 'mailto:' || parsed.protocol === 'ftp:'))
        );
    } catch {
        return false;
    }
}

const TipTapRichEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
    (
        { value, initialValue, onChange, onBlur, disabled = false, placeholder, className, footer },
        ref
    ) => {
        const initialHtml = value ?? initialValue ?? '';
        const onChangeRef = useRef(onChange);
        onChangeRef.current = onChange;
        const onBlurRef = useRef(onBlur);
        onBlurRef.current = onBlur;

        // Tracks the last HTML synchronized with the parent so debounced self-edits never
        // bounce back through `setContent` and disturb selection or undo history.
        const lastSyncedHtmlRef = useRef(initialHtml);
        const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
        const dirtyRef = useRef(false);

        const extensions = useMemo(() => createEo3Extensions({ placeholder }), [placeholder]);

        const emitNow = useCallback((instance: Editor | null) => {
            if (pendingTimerRef.current !== null) {
                clearTimeout(pendingTimerRef.current);
                pendingTimerRef.current = null;
            }
            if (!instance || !dirtyRef.current) return;
            dirtyRef.current = false;
            const html = editorContentToHtml(instance.getHTML());
            if (html === lastSyncedHtmlRef.current) return;
            lastSyncedHtmlRef.current = html;
            onChangeRef.current?.(html);
        }, []);

        const scheduleEmit = useCallback(
            (instance: Editor) => {
                dirtyRef.current = true;
                if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current);
                pendingTimerRef.current = setTimeout(() => {
                    pendingTimerRef.current = null;
                    emitNow(instance);
                }, SYNC_DEBOUNCE_MS);
            },
            [emitNow]
        );

        const editor = useEditor(
            {
                extensions,
                content: htmlToEditorContent(initialHtml),
                editable: !disabled,
                // Keep keystrokes out of React's render loop; only `EditorToolbar` /
                // `SelectionBubble` subscribe via `useEditorState`.
                shouldRerenderOnTransaction: false,
                onUpdate: ({ editor: instance }) => {
                    scheduleEmit(instance);
                },
                onBlur: ({ editor: instance }) => {
                    emitNow(instance);
                    onBlurRef.current?.();
                },
            },
            [extensions]
        );

        // Keep editable state in sync.
        useEffect(() => {
            if (!editor || editor.isDestroyed) return;
            if (editor.isEditable !== !disabled) editor.setEditable(!disabled, false);
        }, [editor, disabled]);

        // Flush any pending debounced edits when unmounting, hiding the tab, or closing the page.
        const editorRef = useRef<Editor | null>(null);
        editorRef.current = editor;
        useEffect(() => {
            const flush = () => emitNow(editorRef.current);
            const onVisibility = () => {
                if (document.visibilityState === 'hidden') flush();
            };
            window.addEventListener('pagehide', flush);
            document.addEventListener('visibilitychange', onVisibility);
            return () => {
                window.removeEventListener('pagehide', flush);
                document.removeEventListener('visibilitychange', onVisibility);
                flush();
            };
        }, [emitNow]);

        // Sync external controlled `value` updates (Document undo/redo, version restore, code mode).
        useEffect(() => {
            if (value === undefined || !editor || editor.isDestroyed) return;
            if (value === lastSyncedHtmlRef.current) return;
            if (pendingTimerRef.current !== null) {
                clearTimeout(pendingTimerRef.current);
                pendingTimerRef.current = null;
            }
            dirtyRef.current = false;
            lastSyncedHtmlRef.current = value;
            const current = editorContentToHtml(editor.getHTML());
            if (current !== value) {
                editor.commands.setContent(htmlToEditorContent(value), { emitUpdate: false });
            }
        }, [editor, value]);

        useImperativeHandle(
            ref,
            () => ({
                getEditor: () => editor,
                getContent: () => (editor ? editorContentToHtml(editor.getHTML()) : ''),
                setContent: (content: string) => {
                    if (!editor || editor.isDestroyed) return;
                    if (pendingTimerRef.current !== null) {
                        clearTimeout(pendingTimerRef.current);
                        pendingTimerRef.current = null;
                    }
                    dirtyRef.current = false;
                    lastSyncedHtmlRef.current = content;
                    editor.commands.setContent(htmlToEditorContent(content), { emitUpdate: false });
                },
                insertChapterBreak: () => {
                    if (!editor || editor.isDestroyed) return;
                    editor.chain().focus().insertChapterBreak().run();
                    dirtyRef.current = true;
                    emitNow(editor);
                },
                flush: () => emitNow(editor),
                cancelPending: () => {
                    if (pendingTimerRef.current !== null) {
                        clearTimeout(pendingTimerRef.current);
                        pendingTimerRef.current = null;
                    }
                    dirtyRef.current = false;
                },
                focus: () => {
                    editor?.commands.focus();
                },
            }),
            [editor, emitNow]
        );

        const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
        const [rubyAnchor, setRubyAnchor] = useState<HTMLElement | null>(null);

        return (
            <div className={'tiptap-rich-editor' + (className ? ' ' + className : '')}>
                {editor ? (
                    <>
                        <EditorToolbar
                            editor={editor}
                            disabled={disabled}
                            onOpenLink={setLinkAnchor}
                            onOpenRuby={setRubyAnchor}
                        />
                        <SelectionBubble
                            editor={editor}
                            disabled={disabled}
                            onOpenLink={setLinkAnchor}
                            onOpenRuby={setRubyAnchor}
                        />
                        <LinkPopover
                            editor={editor}
                            anchor={linkAnchor}
                            onClose={() => {
                                setLinkAnchor(null);
                                editor.commands.focus();
                            }}
                        />
                        <RubyPopover
                            editor={editor}
                            anchor={rubyAnchor}
                            onClose={() => {
                                setRubyAnchor(null);
                                editor.commands.focus();
                            }}
                        />
                    </>
                ) : null}
                <div className="i-editor-surface">
                    <EditorContent editor={editor} />
                </div>
                {footer ? <footer className="editor-footer">{footer}</footer> : null}
            </div>
        );
    }
);

TipTapRichEditor.displayName = 'TipTapRichEditor';

export default TipTapRichEditor;

/** Keeps focus inside the editor when clicking direct formatting toolbar buttons. */
function preventFocusSteal(e: React.MouseEvent) {
    e.preventDefault();
}

function ToolbarButton({
    label,
    active = false,
    disabled = false,
    onClick,
    children,
    buttonRef,
}: {
    label: string;
    active?: boolean;
    disabled?: boolean;
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
    children: React.ReactNode;
    buttonRef?: React.Ref<HTMLButtonElement>;
}) {
    return (
        <button
            ref={buttonRef}
            type="button"
            className={'i-tool-btn' + (active ? ' is-active' : '')}
            aria-label={label}
            aria-pressed={active}
            title={label}
            disabled={disabled}
            onMouseDown={preventFocusSteal}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function EditorToolbar({
    editor,
    disabled,
    onOpenLink,
    onOpenRuby,
}: {
    editor: Editor;
    disabled: boolean;
    onOpenLink: (anchor: HTMLElement) => void;
    onOpenRuby: (anchor: HTMLElement) => void;
}) {
    const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
    const [imageAnchor, setImageAnchor] = useState<HTMLElement | null>(null);

    const state = useEditorState({
        editor,
        selector: ({ editor: e }) => {
            const blockStyle = e.isActive('heading', { level: 1 })
                ? 'h1'
                : e.isActive('heading', { level: 2 })
                ? 'h2'
                : e.isActive('heading', { level: 3 })
                ? 'h3'
                : e.isActive('heading', { level: 4 })
                ? 'h4'
                : 'p';
            const attrs = e.getAttributes('textStyle') as {
                color?: string;
                backgroundColor?: string;
            };
            const dir: TextDirection =
                (e.getAttributes('paragraph').dir as TextDirection) ||
                (e.getAttributes('heading').dir as TextDirection) ||
                (e.getAttributes('blockquote').dir as TextDirection) ||
                null;
            return {
                blockStyle,
                bold: e.isActive('bold'),
                italic: e.isActive('italic'),
                underline: e.isActive('underline'),
                strike: e.isActive('strike'),
                subscript: e.isActive('subscript'),
                superscript: e.isActive('superscript'),
                code: e.isActive('code'),
                link: e.isActive('link'),
                ruby: getSelectedRuby(e) !== null,
                blockquote: e.isActive('blockquote'),
                bulletList: e.isActive('bulletList'),
                orderedList: e.isActive('orderedList'),
                alignLeft: e.isActive({ textAlign: 'left' }),
                alignCenter: e.isActive({ textAlign: 'center' }),
                alignRight: e.isActive({ textAlign: 'right' }),
                alignJustify: e.isActive({ textAlign: 'justify' }),
                color: attrs.color ?? '',
                backgroundColor: attrs.backgroundColor ?? '',
                dir,
                canUndo: e.can().undo(),
                canRedo: e.can().redo(),
            };
        },
    });

    const onBlockStyleChange = (value: string) => {
        if (value === 'p') {
            editor.chain().focus().setParagraph().run();
            return;
        }
        const level = Number(value.slice(1)) as 1 | 2 | 3 | 4;
        editor.chain().focus().toggleHeading({ level }).run();
    };

    return (
        <div className="i-toolbar" role="toolbar" aria-label="Text formatting">
            <select
                className="i-block-select"
                aria-label="Text style"
                title="Text style"
                disabled={disabled}
                value={state.blockStyle}
                onChange={(e) => onBlockStyleChange(e.target.value)}
            >
                <option value="p">Paragraph</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="h4">Heading 4</option>
            </select>

            <span className="i-sep" aria-hidden="true" />

            <ToolbarButton
                label="Bold"
                active={state.bold}
                disabled={disabled}
                onClick={() => editor.chain().focus().toggleBold().run()}
            >
                <strong>B</strong>
            </ToolbarButton>
            <ToolbarButton
                label="Italic"
                active={state.italic}
                disabled={disabled}
                onClick={() => editor.chain().focus().toggleItalic().run()}
            >
                <em>I</em>
            </ToolbarButton>
            <ToolbarButton
                label="Underline"
                active={state.underline}
                disabled={disabled}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
                <u>U</u>
            </ToolbarButton>
            <ToolbarButton
                label="Strikethrough"
                active={state.strike}
                disabled={disabled}
                onClick={() => editor.chain().focus().toggleStrike().run()}
            >
                <s>S</s>
            </ToolbarButton>
            <ToolbarButton
                label="Subscript"
                active={state.subscript}
                disabled={disabled}
                onClick={() => editor.chain().focus().toggleSubscript().run()}
            >
                x<sub>2</sub>
            </ToolbarButton>
            <ToolbarButton
                label="Superscript"
                active={state.superscript}
                disabled={disabled}
                onClick={() => editor.chain().focus().toggleSuperscript().run()}
            >
                x<sup>2</sup>
            </ToolbarButton>
            <ToolbarButton
                label="Inline code"
                active={state.code}
                disabled={disabled}
                onClick={() => editor.chain().focus().toggleCode().run()}
            >
                <code>&lt;/&gt;</code>
            </ToolbarButton>
            <ToolbarButton
                label="Text and highlight color"
                active={!!state.color || !!state.backgroundColor}
                disabled={disabled}
                onClick={(e) => setColorAnchor(e.currentTarget)}
            >
                <span
                    className="i-color-swatch-label"
                    style={{
                        borderBottomColor: state.color || 'currentColor',
                        backgroundColor: state.backgroundColor || 'transparent',
                    }}
                >
                    A
                </span>
            </ToolbarButton>
            <ToolbarButton
                label="Clear formatting"
                disabled={disabled}
                onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
            >
                Tx
            </ToolbarButton>

            <span className="i-sep" aria-hidden="true" />

            <ToolbarButton
                label="Link"
                active={state.link}
                disabled={disabled}
                onClick={(e) => onOpenLink(e.currentTarget)}
            >
                Link
            </ToolbarButton>
            <ToolbarButton
                label="Insert image"
                disabled={disabled}
                onClick={(e) => setImageAnchor(e.currentTarget)}
            >
                Img
            </ToolbarButton>
            <ToolbarButton
                label="Ruby / furigana"
                active={state.ruby}
                disabled={disabled}
                onClick={(e) => onOpenRuby(e.currentTarget)}
            >
                漢
            </ToolbarButton>

            <span className="i-sep" aria-hidden="true" />

            <ToolbarButton
                label="Blockquote"
                active={state.blockquote}
                disabled={disabled}
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
                “”
            </ToolbarButton>
            <ToolbarButton
                label="Bulleted list"
                active={state.bulletList}
                disabled={disabled}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
                • List
            </ToolbarButton>
            <ToolbarButton
                label="Numbered list"
                active={state.orderedList}
                disabled={disabled}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
                1. List
            </ToolbarButton>
            <ToolbarButton
                label="Horizontal rule"
                disabled={disabled}
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
            >
                ―
            </ToolbarButton>

            <span className="i-sep" aria-hidden="true" />

            <ToolbarButton
                label="Align left"
                active={state.alignLeft}
                disabled={disabled}
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
            >
                ⇤
            </ToolbarButton>
            <ToolbarButton
                label="Align center"
                active={state.alignCenter}
                disabled={disabled}
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
            >
                ↔
            </ToolbarButton>
            <ToolbarButton
                label="Align right"
                active={state.alignRight}
                disabled={disabled}
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
            >
                ⇥
            </ToolbarButton>
            <ToolbarButton
                label="Justify"
                active={state.alignJustify}
                disabled={disabled}
                onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            >
                ≡
            </ToolbarButton>
            <ToolbarButton
                label="Right-to-left"
                active={state.dir === 'rtl'}
                disabled={disabled}
                onClick={() =>
                    editor
                        .chain()
                        .focus()
                        .setTextDirection(state.dir === 'rtl' ? null : 'rtl')
                        .run()
                }
            >
                RTL
            </ToolbarButton>

            <span className="i-sep" aria-hidden="true" />

            <ToolbarButton
                label="Undo"
                disabled={disabled || !state.canUndo}
                onClick={() => editor.chain().focus().undo().run()}
            >
                ↶
            </ToolbarButton>
            <ToolbarButton
                label="Redo"
                disabled={disabled || !state.canRedo}
                onClick={() => editor.chain().focus().redo().run()}
            >
                ↷
            </ToolbarButton>

            <ColorPopover
                editor={editor}
                anchor={colorAnchor}
                color={state.color}
                backgroundColor={state.backgroundColor}
                onClose={() => {
                    setColorAnchor(null);
                    editor.commands.focus();
                }}
            />
            <ImagePopover
                editor={editor}
                anchor={imageAnchor}
                onClose={() => {
                    setImageAnchor(null);
                    editor.commands.focus();
                }}
            />
        </div>
    );
}

/**
 * Floating toolbar shown over non-empty text selections for fast inline formatting (and the hook
 * point for upcoming CSS pieces and selection templates).
 */
function SelectionBubble({
    editor,
    disabled,
    onOpenLink,
    onOpenRuby,
}: {
    editor: Editor;
    disabled: boolean;
    onOpenLink: (anchor: HTMLElement) => void;
    onOpenRuby: (anchor: HTMLElement) => void;
}) {
    const state = useEditorState({
        editor,
        selector: ({ editor: e }) => ({
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            underline: e.isActive('underline'),
            strike: e.isActive('strike'),
            code: e.isActive('code'),
            link: e.isActive('link'),
            ruby: getSelectedRuby(e) !== null,
        }),
    });

    if (disabled) return null;

    return (
        <BubbleMenu
            editor={editor}
            shouldShow={({ editor: e, state: s }) => {
                if (!e.isEditable) return false;
                const { empty } = s.selection;
                if (empty) return false;
                if (e.isActive('chapterBreak') || e.isActive('image') || e.isActive('codeBlock')) {
                    return false;
                }
                return true;
            }}
        >
            <div className="tiptap-bubble-menu" role="toolbar" aria-label="Selection formatting">
                <ToolbarButton
                    label="Bold"
                    active={state.bold}
                    onClick={() => editor.chain().focus().toggleBold().run()}
                >
                    <strong>B</strong>
                </ToolbarButton>
                <ToolbarButton
                    label="Italic"
                    active={state.italic}
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                >
                    <em>I</em>
                </ToolbarButton>
                <ToolbarButton
                    label="Underline"
                    active={state.underline}
                    onClick={() => editor.chain().focus().toggleUnderline().run()}
                >
                    <u>U</u>
                </ToolbarButton>
                <ToolbarButton
                    label="Strikethrough"
                    active={state.strike}
                    onClick={() => editor.chain().focus().toggleStrike().run()}
                >
                    <s>S</s>
                </ToolbarButton>
                <ToolbarButton
                    label="Inline code"
                    active={state.code}
                    onClick={() => editor.chain().focus().toggleCode().run()}
                >
                    <code>&lt;/&gt;</code>
                </ToolbarButton>
                <ToolbarButton
                    label="Link"
                    active={state.link}
                    onClick={(e) => onOpenLink(e.currentTarget)}
                >
                    Link
                </ToolbarButton>
                <ToolbarButton
                    label="Ruby / furigana"
                    active={state.ruby}
                    onClick={(e) => onOpenRuby(e.currentTarget)}
                >
                    漢
                </ToolbarButton>
                <ToolbarButton
                    label="Clear formatting"
                    onClick={() => editor.chain().focus().unsetAllMarks().run()}
                >
                    Tx
                </ToolbarButton>
            </div>
        </BubbleMenu>
    );
}

function LinkPopover({
    editor,
    anchor,
    onClose,
}: {
    editor: Editor;
    anchor: HTMLElement | null;
    onClose: () => void;
}) {
    const open = !!anchor;
    const [href, setHref] = useState('');
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        const current = (editor.getAttributes('link').href as string | undefined) ?? '';
        setHref(current);
        setError('');
    }, [open, editor]);

    useFocusWhenShown(open, () => inputRef.current);

    const apply = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = href.trim();
        if (!trimmed) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            onClose();
            return;
        }
        const normalized =
            /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ||
            trimmed.startsWith('#') ||
            trimmed.startsWith('/')
                ? trimmed
                : `https://${trimmed}`;
        if (!isSafeUrl(normalized, true)) {
            setError('Enter an http, https, mailto, or relative link.');
            return;
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run();
        onClose();
    };

    const hasLink = open && editor.isActive('link');

    return (
        <DirPopover anchor={anchor} open={open} onClose={onClose}>
            <form className="tiptap-popover-form" onSubmit={apply}>
                <label className="i-field">
                    <span>Link URL</span>
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="https://example.com"
                        value={href}
                        onChange={(e) => {
                            setHref(e.target.value);
                            setError('');
                        }}
                    />
                </label>
                {error ? <p className="i-error">{error}</p> : null}
                <div className="i-actions">
                    {hasLink ? (
                        <button
                            type="button"
                            onClick={() => {
                                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                                onClose();
                            }}
                        >
                            Remove
                        </button>
                    ) : null}
                    <button type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="is-primary">
                        Apply
                    </button>
                </div>
            </form>
        </DirPopover>
    );
}

function ImagePopover({
    editor,
    anchor,
    onClose,
}: {
    editor: Editor;
    anchor: HTMLElement | null;
    onClose: () => void;
}) {
    const open = !!anchor;
    const [src, setSrc] = useState('');
    const [alt, setAlt] = useState('');
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        const attrs = editor.isActive('image')
            ? (editor.getAttributes('image') as { src?: string; alt?: string })
            : {};
        setSrc(attrs.src ?? '');
        setAlt(attrs.alt ?? '');
        setError('');
    }, [open, editor]);

    useFocusWhenShown(open, () => inputRef.current);

    const apply = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = src.trim();
        if (!isSafeUrl(trimmed, false)) {
            setError('Enter a full http:// or https:// image URL.');
            return;
        }
        editor.chain().focus().setImage({ src: trimmed, alt: alt.trim() }).run();
        onClose();
    };

    return (
        <DirPopover anchor={anchor} open={open} onClose={onClose}>
            <form className="tiptap-popover-form" onSubmit={apply}>
                <label className="i-field">
                    <span>Image URL</span>
                    <input
                        ref={inputRef}
                        type="url"
                        placeholder="https://example.com/image.png"
                        value={src}
                        onChange={(e) => {
                            setSrc(e.target.value);
                            setError('');
                        }}
                    />
                </label>
                <label className="i-field">
                    <span>Alt text</span>
                    <input
                        type="text"
                        placeholder="Description for screen readers"
                        value={alt}
                        onChange={(e) => setAlt(e.target.value)}
                    />
                </label>
                {error ? <p className="i-error">{error}</p> : null}
                <div className="i-actions">
                    <button type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="is-primary">
                        Insert
                    </button>
                </div>
            </form>
        </DirPopover>
    );
}

function RubyPopover({
    editor,
    anchor,
    onClose,
}: {
    editor: Editor;
    anchor: HTMLElement | null;
    onClose: () => void;
}) {
    const open = !!anchor;
    const [base, setBase] = useState('');
    const [ruby, setRuby] = useState('');
    const [useRp, setUseRp] = useState(true);
    const [editing, setEditing] = useState(false);
    const [error, setError] = useState('');
    const baseRef = useRef<HTMLInputElement>(null);
    const rubyRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        const selected = getSelectedRuby(editor);
        if (selected) {
            setBase(selected.base);
            setRuby(selected.ruby);
            setUseRp(selected.useRp);
            setEditing(true);
        } else {
            const { from, to } = editor.state.selection;
            const text = from !== to ? editor.state.doc.textBetween(from, to, ' ') : '';
            setBase(text);
            setRuby('');
            setUseRp(true);
            setEditing(false);
        }
        setError('');
    }, [open, editor]);

    useFocusWhenShown(open, () => (base ? rubyRef.current : baseRef.current));

    const apply = (e: React.FormEvent) => {
        e.preventDefault();
        if (!base.trim() || !ruby.trim()) {
            setError('Both base text and ruby text are required.');
            return;
        }
        editor.chain().focus().setRuby({ base, ruby, useRp }).run();
        onClose();
    };

    return (
        <DirPopover anchor={anchor} open={open} onClose={onClose}>
            <form className="tiptap-popover-form" onSubmit={apply}>
                <label className="i-field">
                    <span>Base text (e.g. 漢)</span>
                    <input
                        ref={baseRef}
                        type="text"
                        value={base}
                        onChange={(e) => {
                            setBase(e.target.value);
                            setError('');
                        }}
                    />
                </label>
                <label className="i-field">
                    <span>Ruby / furigana (e.g. かん)</span>
                    <input
                        ref={rubyRef}
                        type="text"
                        value={ruby}
                        onChange={(e) => {
                            setRuby(e.target.value);
                            setError('');
                        }}
                    />
                </label>
                <label className="i-checkbox">
                    <input
                        type="checkbox"
                        checked={useRp}
                        onChange={(e) => setUseRp(e.target.checked)}
                    />
                    <span>Include &lt;rp&gt; fallback parentheses</span>
                </label>
                {error ? <p className="i-error">{error}</p> : null}
                <div className="i-actions">
                    {editing ? (
                        <button
                            type="button"
                            onClick={() => {
                                editor.chain().focus().unsetRuby().run();
                                onClose();
                            }}
                        >
                            Remove
                        </button>
                    ) : null}
                    <button type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="is-primary">
                        {editing ? 'Update' : 'Insert'}
                    </button>
                </div>
            </form>
        </DirPopover>
    );
}

function ColorPopover({
    editor,
    anchor,
    color,
    backgroundColor,
    onClose,
}: {
    editor: Editor;
    anchor: HTMLElement | null;
    color: string;
    backgroundColor: string;
    onClose: () => void;
}) {
    const open = !!anchor;
    return (
        <DirPopover anchor={anchor} open={open} onClose={onClose}>
            <div className="tiptap-color-popover">
                <div className="i-color-section">
                    <div className="i-color-heading">
                        <span>Text color</span>
                        <button
                            type="button"
                            onClick={() => {
                                editor.chain().focus().unsetColor().run();
                                onClose();
                            }}
                        >
                            Clear
                        </button>
                    </div>
                    <div className="i-swatches">
                        {COLOR_PRESETS.map((hex) => (
                            <button
                                key={hex}
                                type="button"
                                className={'i-swatch' + (color === hex ? ' is-active' : '')}
                                style={{ backgroundColor: hex }}
                                aria-label={`Text color ${hex}`}
                                title={hex}
                                onClick={() => {
                                    editor.chain().focus().setColor(hex).run();
                                    onClose();
                                }}
                            />
                        ))}
                        <label className="i-custom-color" title="Custom text color">
                            <span>+</span>
                            <input
                                type="color"
                                aria-label="Custom text color"
                                value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#870000'}
                                onChange={(e) =>
                                    editor.chain().focus().setColor(e.target.value).run()
                                }
                            />
                        </label>
                    </div>
                </div>

                <div className="i-color-section">
                    <div className="i-color-heading">
                        <span>Highlight</span>
                        <button
                            type="button"
                            onClick={() => {
                                editor.chain().focus().unsetBackgroundColor().run();
                                onClose();
                            }}
                        >
                            Clear
                        </button>
                    </div>
                    <div className="i-swatches">
                        {HIGHLIGHT_PRESETS.map((hex) => (
                            <button
                                key={hex}
                                type="button"
                                className={
                                    'i-swatch' + (backgroundColor === hex ? ' is-active' : '')
                                }
                                style={{ backgroundColor: hex }}
                                aria-label={`Highlight color ${hex}`}
                                title={hex}
                                onClick={() => {
                                    editor.chain().focus().setBackgroundColor(hex).run();
                                    onClose();
                                }}
                            />
                        ))}
                        <label className="i-custom-color" title="Custom highlight color">
                            <span>+</span>
                            <input
                                type="color"
                                aria-label="Custom highlight color"
                                value={
                                    /^#[0-9a-f]{6}$/i.test(backgroundColor)
                                        ? backgroundColor
                                        : '#fff59d'
                                }
                                onChange={(e) =>
                                    editor.chain().focus().setBackgroundColor(e.target.value).run()
                                }
                            />
                        </label>
                    </div>
                </div>
            </div>
        </DirPopover>
    );
}
