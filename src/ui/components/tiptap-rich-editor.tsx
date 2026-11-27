import React, {
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { PluginKey } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { createEo3Extensions } from '../../editor/extensions';
import { editorContentToHtml, htmlToEditorContent } from '../../editor/html-sync';
import type { HoverTranslationAttrs } from '../../editor/hover-translation';
import type { RubyAttrs } from '../../editor/ruby';
import type { TextDirection } from '../../editor/ao3-attributes';
import { extractWorkCssClasses, scopeCanvasCss } from '../../editor/canvas-css';
import {
    BUILTIN_PIECE_CLASSES,
    CSS_PIECES,
    buildSpoilerHtml,
    buildTextMessageThreadHtml,
    findPieceByClass,
    findPieceById,
    renderCustomTemplateHtml,
    type CssPiece,
} from '../../editor/css-pieces';
import { listCustomCssPieces, subscribeLibraryStyles } from '../../storage/style-library';
import { DirPopover } from '../../uikit/dir-popover';
import { ColorPickerPanel } from '../../uikit/color-picker';
import { useFocusWhenShown } from '../focus-when-shown';
import { StyleLibraryModal, type StyleLibraryTab } from './style-library-modal';
import { StyleSwatch } from './style-swatch';
import Checkbox from '../../uikit/checkbox';

const SYNC_DEBOUNCE_MS = 200;

const BLOCK_STYLE_OPTIONS = [
    { value: 'p', label: 'Paragraph' },
    { value: 'h1', label: 'Heading 1' },
    { value: 'h2', label: 'Heading 2' },
    { value: 'h3', label: 'Heading 3' },
    { value: 'h4', label: 'Heading 4' },
] as const;

const BUBBLE_FLOATING_OPTIONS = {
    offset: 8,
    flip: { padding: 8 },
    shift: { padding: 8 },
};

const BUBBLE_CONTAINER_STYLE: React.CSSProperties = {
    zIndex: 20,
};

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

export type PopoverAnchor = HTMLElement | [number, number] | null;

export interface RichTextEditorProps {
    value?: string;
    initialValue?: string;
    onChange?: (content: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    footer?: React.ReactNode;
    /** 'card' renders the boxed editor with fixed toolbar; 'inline' renders seamlessly inside the live preview. */
    variant?: 'card' | 'inline';
    /** Live work/chapter CSS scoped directly onto the WYSIWYG canvas. */
    canvasCss?: string;
    /** Ensures a CSS Piece's AO3-safe stylesheet is added to the work. */
    onEnsurePieceCss?: (piece: CssPiece) => void | Promise<unknown>;
}

export interface RichTextEditorHandle {
    getEditor: () => Editor | null;
    getContent: () => string;
    setContent: (content: string) => void;
    insertChapterBreak: () => void;
    flush: () => void;
    cancelPending: () => void;
    focus: () => void;
    openStyles: (anchor: PopoverAnchor) => void;
    openFormat: (anchor: PopoverAnchor) => void;
    openLink: (anchor: PopoverAnchor) => void;
    openRuby: (anchor: PopoverAnchor) => void;
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

function getSelectedHoverTranslation(editor: Editor): HoverTranslationAttrs | null {
    const { selection } = editor.state;
    if ('node' in selection && selection.node) {
        const node = selection.node as {
            type?: { name?: string };
            attrs?: Partial<HoverTranslationAttrs>;
        };
        if (node.type?.name === 'hoverTranslation') {
            return {
                original: String(node.attrs?.original ?? ''),
                translation: String(node.attrs?.translation ?? ''),
                includeParens: node.attrs?.includeParens !== false,
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

function anchorFromBubbleButton(el: HTMLElement): [number, number] {
    const rect = el.getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.bottom];
}

const TipTapRichEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
    (
        {
            value,
            initialValue,
            onChange,
            onFocus,
            onBlur,
            disabled = false,
            placeholder,
            className,
            footer,
            variant = 'card',
            canvasCss = '',
            onEnsurePieceCss,
        },
        ref
    ) => {
        const isInline = variant === 'inline';
        const initialHtml = value ?? initialValue ?? '';
        const onChangeRef = useRef(onChange);
        onChangeRef.current = onChange;
        const onFocusRef = useRef(onFocus);
        onFocusRef.current = onFocus;
        const onBlurRef = useRef(onBlur);
        onBlurRef.current = onBlur;
        const onEnsurePieceCssRef = useRef(onEnsurePieceCss);
        onEnsurePieceCssRef.current = onEnsurePieceCss;

        // Tracks the last HTML synchronized with the parent so debounced self-edits never
        // bounce back through `setContent` and disturb selection or undo history.
        const lastSyncedHtmlRef = useRef(initialHtml);
        const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
        const dirtyRef = useRef(false);

        const rawCanvasId = useId();
        const safeCanvasId = useMemo(
            () => 'c' + rawCanvasId.replace(/[^a-zA-Z0-9_-]/g, ''),
            [rawCanvasId]
        );
        const [workskinEnabled, setWorkskinEnabled] = useState(true);

        const [customPieces, setCustomPieces] = useState<CssPiece[]>(() => listCustomCssPieces());

        useEffect(() => {
            const refresh = () => setCustomPieces(listCustomCssPieces());
            refresh();
            return subscribeLibraryStyles(refresh);
        }, []);

        const knownPieceClasses = useMemo(
            () =>
                new Set([
                    ...BUILTIN_PIECE_CLASSES,
                    ...customPieces.flatMap((piece) => [
                        piece.className,
                        ...(piece.extraClasses ?? []),
                    ]),
                ]),
            [customPieces]
        );

        const scopedCanvasCss = useMemo(() => {
            if (isInline || !workskinEnabled || !canvasCss.trim()) return '';
            return scopeCanvasCss(canvasCss, `[data-eo3-canvas="${safeCanvasId}"]`);
        }, [isInline, workskinEnabled, canvasCss, safeCanvasId]);

        const workCssClasses = useMemo(
            () => extractWorkCssClasses(canvasCss, knownPieceClasses),
            [canvasCss, knownPieceClasses]
        );

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
                onFocus: () => {
                    onFocusRef.current?.();
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

        const [linkAnchor, setLinkAnchor] = useState<PopoverAnchor>(null);
        const [rubyAnchor, setRubyAnchor] = useState<PopoverAnchor>(null);
        const [translateAnchor, setTranslateAnchor] = useState<PopoverAnchor>(null);
        const [stylesAnchor, setStylesAnchor] = useState<PopoverAnchor>(null);
        const [formatAnchor, setFormatAnchor] = useState<PopoverAnchor>(null);
        const [colorAnchor, setColorAnchor] = useState<PopoverAnchor>(null);
        const [imageAnchor, setImageAnchor] = useState<PopoverAnchor>(null);
        const [blockStyleAnchor, setBlockStyleAnchor] = useState<PopoverAnchor>(null);
        const [styleModal, setStyleModal] = useState<{
            open: boolean;
            tab: StyleLibraryTab;
            editId: string | null;
        }>({ open: false, tab: 'import', editId: null });

        const insertChapterBreakNow = useCallback(() => {
            if (!editor || editor.isDestroyed) return;
            editor.chain().focus().insertChapterBreak().run();
            dirtyRef.current = true;
            emitNow(editor);
        }, [editor, emitNow]);

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
                insertChapterBreak: insertChapterBreakNow,
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
                openStyles: (anchor: PopoverAnchor) => {
                    setFormatAnchor(null);
                    setStylesAnchor((prev) => (prev && prev === anchor ? null : anchor));
                },
                openFormat: (anchor: PopoverAnchor) => {
                    setStylesAnchor(null);
                    setFormatAnchor((prev) => (prev && prev === anchor ? null : anchor));
                },
                openLink: (anchor: PopoverAnchor) => setLinkAnchor(anchor),
                openRuby: (anchor: PopoverAnchor) => setRubyAnchor(anchor),
            }),
            [editor, emitNow, insertChapterBreakNow]
        );

        const applyHoverTranslation = useCallback(
            (attrs: HoverTranslationAttrs) => {
                if (!editor || editor.isDestroyed) return;
                const translatePiece = findPieceById('translate');
                if (translatePiece) {
                    void onEnsurePieceCssRef.current?.(translatePiece);
                }
                setWorkskinEnabled(true);
                editor.chain().focus().setHoverTranslation(attrs).run();
                dirtyRef.current = true;
                emitNow(editor);
            },
            [editor, emitNow]
        );

        const removeHoverTranslation = useCallback(() => {
            if (!editor || editor.isDestroyed) return;
            editor.chain().focus().unsetHoverTranslation().run();
            dirtyRef.current = true;
            emitNow(editor);
        }, [editor, emitNow]);

        const applyPiece = useCallback(
            (piece: CssPiece) => {
                if (!editor || editor.isDestroyed) return;
                void onEnsurePieceCssRef.current?.(piece);
                setWorkskinEnabled(true);

                if (piece.kind === 'inline') {
                    editor.chain().focus().toggleStyledSpan(piece.className).run();
                } else if (piece.kind === 'block') {
                    editor.chain().focus().wrapStyledBlock(piece.className).run();
                } else if (piece.kind === 'template') {
                    const { from, to, empty } = editor.state.selection;
                    const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, '\n');
                    const templateHtml = piece.templateHtml
                        ? renderCustomTemplateHtml(
                              piece.templateHtml,
                              selectedText,
                              piece.previewSample || 'Your text here…'
                          )
                        : piece.id === 'chat'
                        ? buildTextMessageThreadHtml(selectedText)
                        : buildSpoilerHtml(selectedText);
                    editor.chain().focus().insertContent(templateHtml).run();
                }

                dirtyRef.current = true;
                emitNow(editor);
            },
            [editor, emitNow]
        );

        const applyCustomClass = useCallback(
            (className: string, target: 'inline' | 'block') => {
                if (!editor || editor.isDestroyed) return;
                const clean = className.replace(/^\.+/, '').trim();
                if (!clean) return;
                if (target === 'inline') {
                    editor.chain().focus().toggleStyledSpan(clean).run();
                } else {
                    editor.chain().focus().wrapStyledBlock(clean).run();
                }
                dirtyRef.current = true;
                emitNow(editor);
            },
            [editor, emitNow]
        );

        const hasCanvasCss = !!canvasCss.trim();
        const openAnchored = (setter: (a: PopoverAnchor) => void, anchor: PopoverAnchor) => {
            setFormatAnchor(null);
            setter(anchor instanceof HTMLElement ? anchorFromBubbleButton(anchor) : anchor);
        };

        return (
            <div
                className={
                    'tiptap-rich-editor' +
                    (isInline ? ' is-inline' : '') +
                    (className ? ' ' + className : '')
                }
            >
                {scopedCanvasCss ? (
                    <style data-eo3-canvas-style={safeCanvasId}>{scopedCanvasCss}</style>
                ) : null}
                {editor ? (
                    <>
                        {isInline ? (
                            <DirPopover
                                portal
                                anchorBias="right"
                                anchor={formatAnchor}
                                open={!!formatAnchor}
                                onClose={() => {
                                    setFormatAnchor(null);
                                    editor.commands.focus();
                                }}
                            >
                                {formatAnchor ? (
                                    <div className="tiptap-format-popover">
                                        <EditorToolbar
                                            editor={editor}
                                            disabled={disabled}
                                            layout="rows"
                                            hasCanvasCss={false}
                                            workskinEnabled={true}
                                            customPieces={customPieces}
                                            onToggleWorkskin={() => {}}
                                            onOpenBlockStyle={(el) =>
                                                openAnchored(setBlockStyleAnchor, el)
                                            }
                                            onOpenLink={(el) => openAnchored(setLinkAnchor, el)}
                                            onOpenRuby={(el) => openAnchored(setRubyAnchor, el)}
                                            onOpenTranslate={(el) =>
                                                openAnchored(setTranslateAnchor, el)
                                            }
                                            onOpenStyles={(el) => openAnchored(setStylesAnchor, el)}
                                            onOpenColor={(el) => openAnchored(setColorAnchor, el)}
                                            onOpenImage={(el) => openAnchored(setImageAnchor, el)}
                                            onInsertChapterBreak={() => {
                                                setFormatAnchor(null);
                                                insertChapterBreakNow();
                                            }}
                                        />
                                    </div>
                                ) : null}
                            </DirPopover>
                        ) : (
                            <EditorToolbar
                                editor={editor}
                                disabled={disabled}
                                hasCanvasCss={hasCanvasCss}
                                workskinEnabled={workskinEnabled}
                                customPieces={customPieces}
                                onToggleWorkskin={() => setWorkskinEnabled((v) => !v)}
                                onOpenBlockStyle={setBlockStyleAnchor}
                                onOpenLink={setLinkAnchor}
                                onOpenRuby={setRubyAnchor}
                                onOpenTranslate={setTranslateAnchor}
                                onOpenStyles={setStylesAnchor}
                                onOpenColor={setColorAnchor}
                                onOpenImage={setImageAnchor}
                            />
                        )}
                        <SelectionBubble
                            editor={editor}
                            disabled={disabled}
                            customPieces={customPieces}
                            onOpenBlockStyle={(el) =>
                                setBlockStyleAnchor(anchorFromBubbleButton(el))
                            }
                            onOpenLink={(el) => setLinkAnchor(anchorFromBubbleButton(el))}
                            onOpenRuby={(el) => setRubyAnchor(anchorFromBubbleButton(el))}
                            onOpenTranslate={(el) => setTranslateAnchor(anchorFromBubbleButton(el))}
                            onOpenStyles={(el) => setStylesAnchor(anchorFromBubbleButton(el))}
                            onOpenColor={(el) => setColorAnchor(anchorFromBubbleButton(el))}
                            onOpenImage={(el) => setImageAnchor(anchorFromBubbleButton(el))}
                            onInsertChapterBreak={insertChapterBreakNow}
                        />
                        <BlockStylePopover
                            editor={editor}
                            anchor={blockStyleAnchor}
                            onClose={() => {
                                setBlockStyleAnchor(null);
                                editor.commands.focus();
                            }}
                        />
                        <StylesPopover
                            editor={editor}
                            anchor={stylesAnchor}
                            workClasses={workCssClasses}
                            customPieces={customPieces}
                            onApplyPiece={applyPiece}
                            onApplyCustomClass={applyCustomClass}
                            onOpenTranslate={() => {
                                const nextAnchor = stylesAnchor;
                                setStylesAnchor(null);
                                setTranslateAnchor(nextAnchor);
                            }}
                            onOpenStyleManager={(tab, editId = null) => {
                                setStylesAnchor(null);
                                setStyleModal({ open: true, tab, editId });
                            }}
                            onClose={() => {
                                setStylesAnchor(null);
                                editor.commands.focus();
                            }}
                        />
                        <StyleLibraryModal
                            open={styleModal.open}
                            initialTab={styleModal.tab}
                            initialEditId={styleModal.editId}
                            onClose={() => setStyleModal((prev) => ({ ...prev, open: false }))}
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
                        <TranslatePopover
                            editor={editor}
                            anchor={translateAnchor}
                            onApply={applyHoverTranslation}
                            onRemove={removeHoverTranslation}
                            onClose={() => {
                                setTranslateAnchor(null);
                                editor.commands.focus();
                            }}
                        />
                        <ColorPopover
                            editor={editor}
                            anchor={colorAnchor}
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
                    </>
                ) : null}
                {isInline ? (
                    <EditorContent editor={editor} />
                ) : (
                    <div className="i-editor-surface">
                        <div
                            className={
                                'i-wysiwyg-workskin' +
                                (workskinEnabled && hasCanvasCss ? ' has-workskin' : '')
                            }
                            data-eo3-canvas={safeCanvasId}
                        >
                            <EditorContent editor={editor} />
                        </div>
                    </div>
                )}
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

interface ToolbarEditorState {
    blockStyle: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    subscript: boolean;
    superscript: boolean;
    code: boolean;
    link: boolean;
    ruby: boolean;
    blockquote: boolean;
    bulletList: boolean;
    orderedList: boolean;
    alignLeft: boolean;
    alignCenter: boolean;
    alignRight: boolean;
    alignJustify: boolean;
    color: string;
    backgroundColor: string;
    dir: TextDirection;
    styledBlockClass: string | null;
    styledSpanClass: string | null;
    hoverTranslation: string | null;
    inDetails: boolean;
    canUndo: boolean;
    canRedo: boolean;
}

const EMPTY_TOOLBAR_STATE: ToolbarEditorState = {
    blockStyle: 'p',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    subscript: false,
    superscript: false,
    code: false,
    link: false,
    ruby: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    alignLeft: false,
    alignCenter: false,
    alignRight: false,
    alignJustify: false,
    color: '',
    backgroundColor: '',
    dir: null,
    styledBlockClass: null,
    styledSpanClass: null,
    hoverTranslation: null,
    inDetails: false,
    canUndo: false,
    canRedo: false,
};

function selectToolbarState(e: Editor): ToolbarEditorState {
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
    const styledBlockClass = e.isActive('styledBlock')
        ? (e.getAttributes('styledBlock').class as string | null) ?? null
        : null;
    const styledSpanClass = e.isActive('styledSpan')
        ? (e.getAttributes('styledSpan').class as string | null) ?? null
        : null;
    const selectedTranslation = getSelectedHoverTranslation(e);
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
        styledBlockClass,
        styledSpanClass,
        hoverTranslation: selectedTranslation ? selectedTranslation.translation : null,
        inDetails: e.isActive('details'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
    };
}

function applyBlockStyle(editor: Editor, value: string) {
    if (value === 'p') {
        editor.chain().focus().setParagraph().run();
        return;
    }
    const level = Number(value.slice(1)) as 1 | 2 | 3 | 4;
    editor.chain().focus().toggleHeading({ level }).run();
}

function ActiveStyleChips({
    editor,
    state,
    customPieces,
    onEditTranslate,
}: {
    editor: Editor;
    state: Pick<
        ToolbarEditorState,
        'styledBlockClass' | 'styledSpanClass' | 'hoverTranslation' | 'inDetails'
    >;
    customPieces: readonly CssPiece[];
    onEditTranslate: (anchor: HTMLElement) => void;
}) {
    const activeBlockPiece = findPieceByClass(state.styledBlockClass, customPieces);
    const activeSpanPiece = findPieceByClass(state.styledSpanClass, customPieces);

    return (
        <>
            {state.styledBlockClass ? (
                <span
                    className="i-active-chip"
                    title={`Inside <div class="${state.styledBlockClass}">`}
                >
                    <span className="i-chip-label">
                        {activeBlockPiece?.label ?? `.${state.styledBlockClass}`}
                    </span>
                    <button
                        type="button"
                        className="i-chip-btn"
                        aria-label="Insert paragraph after styled block"
                        title="Exit block below (Ctrl/Cmd+Enter)"
                        onMouseDown={preventFocusSteal}
                        onClick={() => editor.chain().focus().exitStyledBlock().run()}
                    >
                        ↵
                    </button>
                    <button
                        type="button"
                        className="i-chip-btn"
                        aria-label="Remove block style"
                        title="Unwrap styled block"
                        onMouseDown={preventFocusSteal}
                        onClick={() => editor.chain().focus().unwrapStyledBlock().run()}
                    >
                        ×
                    </button>
                </span>
            ) : null}

            {state.styledSpanClass ? (
                <span
                    className="i-active-chip"
                    title={`Inline <span class="${state.styledSpanClass}">`}
                >
                    <span className="i-chip-label">
                        {activeSpanPiece?.label ?? `.${state.styledSpanClass}`}
                    </span>
                    <button
                        type="button"
                        className="i-chip-btn"
                        aria-label="Remove inline style"
                        title="Remove inline style"
                        onMouseDown={preventFocusSteal}
                        onClick={() => editor.chain().focus().unsetStyledSpan().run()}
                    >
                        ×
                    </button>
                </span>
            ) : null}

            {state.hoverTranslation !== null ? (
                <span
                    className="i-active-chip"
                    title={`Translate on hover: ${state.hoverTranslation}`}
                >
                    <span className="i-chip-label">{state.hoverTranslation}</span>
                    <button
                        type="button"
                        className="i-chip-btn"
                        aria-label="Edit hover translation"
                        title="Edit translation"
                        onMouseDown={preventFocusSteal}
                        onClick={(e) => onEditTranslate(e.currentTarget)}
                    >
                        ✎
                    </button>
                    <button
                        type="button"
                        className="i-chip-btn"
                        aria-label="Remove hover translation"
                        title="Remove hover translation"
                        onMouseDown={preventFocusSteal}
                        onClick={() => editor.chain().focus().unsetHoverTranslation().run()}
                    >
                        ×
                    </button>
                </span>
            ) : null}

            {state.inDetails ? (
                <span className="i-active-chip" title="Inside collapsible spoiler (<details>)">
                    <span className="i-chip-label">Spoiler</span>
                    <button
                        type="button"
                        className="i-chip-btn"
                        aria-label="Insert paragraph after spoiler"
                        title="Exit spoiler below (Ctrl/Cmd+Enter)"
                        onMouseDown={preventFocusSteal}
                        onClick={() => editor.chain().focus().exitDetails().run()}
                    >
                        ↵
                    </button>
                </span>
            ) : null}
        </>
    );
}

function BlockStyleButton({
    blockStyle,
    disabled = false,
    onClick,
}: {
    blockStyle: string;
    disabled?: boolean;
    onClick: (el: HTMLElement) => void;
}) {
    const label = BLOCK_STYLE_OPTIONS.find((opt) => opt.value === blockStyle)?.label ?? 'Paragraph';
    return (
        <button
            type="button"
            className="i-tool-btn i-block-select"
            aria-label="Text style"
            aria-haspopup="menu"
            title="Text style"
            disabled={disabled}
            onMouseDown={preventFocusSteal}
            onClick={(e) => onClick(e.currentTarget)}
        >
            <span className="i-block-select-label">{label}</span>
            <svg
                className="i-block-select-caret"
                viewBox="0 0 12 12"
                width="10"
                height="10"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M2.5 4.25L6 7.75L9.5 4.25" />
            </svg>
        </button>
    );
}

function BlockStylePopover({
    editor,
    anchor,
    onClose,
}: {
    editor: Editor;
    anchor: PopoverAnchor;
    onClose: () => void;
}) {
    const open = !!anchor;
    return (
        <DirPopover portal anchor={anchor} open={open} onClose={onClose}>
            {open ? <BlockStyleMenuContent editor={editor} onClose={onClose} /> : null}
        </DirPopover>
    );
}

function BlockStyleMenuContent({ editor, onClose }: { editor: Editor; onClose: () => void }) {
    const current = editor.isActive('heading', { level: 1 })
        ? 'h1'
        : editor.isActive('heading', { level: 2 })
        ? 'h2'
        : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : editor.isActive('heading', { level: 4 })
        ? 'h4'
        : 'p';

    return (
        <div className="tiptap-block-style-menu" role="menu" aria-label="Text style">
            {BLOCK_STYLE_OPTIONS.map((opt) => {
                const selected = current === opt.value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={'i-menu-item is-' + opt.value + (selected ? ' is-active' : '')}
                        onClick={() => {
                            applyBlockStyle(editor, opt.value);
                            onClose();
                        }}
                    >
                        <span className="i-menu-item-label">{opt.label}</span>
                        {selected ? (
                            <span className="i-menu-check" aria-hidden="true">
                                ✓
                            </span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}

function EditorToolbar({
    editor,
    disabled,
    layout = 'flow',
    hasCanvasCss,
    workskinEnabled,
    customPieces,
    onToggleWorkskin,
    onOpenBlockStyle,
    onOpenLink,
    onOpenRuby,
    onOpenTranslate,
    onOpenStyles,
    onOpenColor,
    onOpenImage,
    onInsertChapterBreak,
}: {
    editor: Editor;
    disabled: boolean;
    layout?: 'flow' | 'rows';
    hasCanvasCss: boolean;
    workskinEnabled: boolean;
    customPieces: readonly CssPiece[];
    onToggleWorkskin: () => void;
    onOpenBlockStyle: (anchor: PopoverAnchor) => void;
    onOpenLink: (anchor: PopoverAnchor) => void;
    onOpenRuby: (anchor: PopoverAnchor) => void;
    onOpenTranslate: (anchor: PopoverAnchor) => void;
    onOpenStyles: (anchor: PopoverAnchor) => void;
    onOpenColor: (anchor: PopoverAnchor) => void;
    onOpenImage: (anchor: PopoverAnchor) => void;
    onInsertChapterBreak?: () => void;
}) {
    const state = useEditorState({
        editor,
        selector: ({ editor: e }) => selectToolbarState(e),
    });

    const hasActiveStyle = !!(
        state.styledBlockClass ||
        state.styledSpanClass ||
        state.hoverTranslation !== null ||
        state.inDetails
    );

    const blockSelectBtn = (
        <BlockStyleButton
            blockStyle={state.blockStyle}
            disabled={disabled}
            onClick={(el) => onOpenBlockStyle(el)}
        />
    );

    const stylesBtn = (
        <button
            type="button"
            className={'i-tool-btn i-styles-btn' + (hasActiveStyle ? ' is-active' : '')}
            aria-label="CSS pieces and templates"
            title="Apply CSS pieces, templates, or Work Skin classes"
            disabled={disabled}
            onMouseDown={preventFocusSteal}
            onClick={(e) => onOpenStyles(e.currentTarget)}
        >
            ✦ Styles
        </button>
    );

    const primaryMarks = (
        <>
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
        </>
    );

    const colorAndClear = (
        <>
            <ToolbarButton
                label="Text and highlight color"
                active={!!state.color || !!state.backgroundColor}
                disabled={disabled}
                onClick={(e) => onOpenColor(e.currentTarget)}
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
        </>
    );

    const insertButtons = (
        <>
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
                onClick={(e) => onOpenImage(e.currentTarget)}
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
        </>
    );

    const blockButtons = (
        <>
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
        </>
    );

    const alignAndHistory = (
        <>
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

            {onInsertChapterBreak ? (
                <>
                    <span className="i-sep" aria-hidden="true" />
                    <ToolbarButton
                        label="Insert chapter break"
                        disabled={disabled}
                        onClick={onInsertChapterBreak}
                    >
                        + Break
                    </ToolbarButton>
                </>
            ) : null}

            {hasCanvasCss ? (
                <>
                    <span className="i-sep" aria-hidden="true" />
                    <ToolbarButton
                        label={
                            workskinEnabled
                                ? 'Live Work Skin CSS is on (click to edit unstyled)'
                                : 'Show live Work Skin CSS inside the editor'
                        }
                        active={workskinEnabled}
                        disabled={disabled}
                        onClick={onToggleWorkskin}
                    >
                        Skin
                    </ToolbarButton>
                </>
            ) : null}

            <ActiveStyleChips
                editor={editor}
                state={state}
                customPieces={customPieces}
                onEditTranslate={onOpenTranslate}
            />
        </>
    );

    if (layout === 'rows') {
        return (
            <div className="i-toolbar is-rows" role="toolbar" aria-label="Text formatting">
                <div className="i-toolbar-row">
                    {blockSelectBtn}
                    {stylesBtn}
                    <span className="i-sep" aria-hidden="true" />
                    {primaryMarks}
                </div>
                <div className="i-toolbar-row">
                    {colorAndClear}
                    <span className="i-sep" aria-hidden="true" />
                    {insertButtons}
                    <span className="i-sep" aria-hidden="true" />
                    {blockButtons}
                </div>
                <div className="i-toolbar-row">{alignAndHistory}</div>
            </div>
        );
    }

    return (
        <div className="i-toolbar" role="toolbar" aria-label="Text formatting">
            {blockSelectBtn}
            {stylesBtn}
            <span className="i-sep" aria-hidden="true" />
            {primaryMarks}
            {colorAndClear}
            <span className="i-sep" aria-hidden="true" />
            {insertButtons}
            <span className="i-sep" aria-hidden="true" />
            {blockButtons}
            <span className="i-sep" aria-hidden="true" />
            {alignAndHistory}
        </div>
    );
}

/**
 * Floating toolbar shown over non-empty text selections for fast inline formatting, CSS pieces,
 * and selection templates. Expands via its chevron button to 3 rows containing all formatting
 * controls.
 */
function shouldShowSelectionBubble({
    editor: e,
    state: s,
}: {
    editor: Editor;
    state: Editor['state'];
}): boolean {
    if (!e.isEditable) return false;
    if (s.selection.empty) return false;
    if (e.isActive('chapterBreak') || e.isActive('image') || e.isActive('codeBlock')) {
        return false;
    }
    return true;
}

function SelectionBubble({
    editor,
    disabled,
    customPieces,
    onOpenBlockStyle,
    onOpenLink,
    onOpenRuby,
    onOpenTranslate,
    onOpenStyles,
    onOpenColor,
    onOpenImage,
    onInsertChapterBreak,
}: {
    editor: Editor;
    disabled: boolean;
    customPieces: readonly CssPiece[];
    onOpenBlockStyle: (anchor: HTMLElement) => void;
    onOpenLink: (anchor: HTMLElement) => void;
    onOpenRuby: (anchor: HTMLElement) => void;
    onOpenTranslate: (anchor: HTMLElement) => void;
    onOpenStyles: (anchor: HTMLElement) => void;
    onOpenColor: (anchor: HTMLElement) => void;
    onOpenImage: (anchor: HTMLElement) => void;
    onInsertChapterBreak?: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const bubblePluginKey = useMemo(() => new PluginKey('selectionBubble'), []);
    const bubbleRef = useRef<HTMLDivElement>(null);

    const state = useEditorState({
        editor,
        selector: ({ editor: e }) => {
            if (e.state.selection.empty) return EMPTY_TOOLBAR_STATE;
            return selectToolbarState(e);
        },
    });

    const repositionBubble = useCallback(() => {
        if (disabled || editor.isDestroyed || editor.state.selection.empty) return;
        editor.view.dispatch(editor.state.tr.setMeta(bubblePluginKey, 'updatePosition'));
    }, [editor, disabled, bubblePluginKey]);

    // Reposition synchronously after DOM layout commits whenever rows expand/collapse or active chips change.
    useLayoutEffect(() => {
        repositionBubble();
    }, [
        repositionBubble,
        expanded,
        state.styledBlockClass,
        state.styledSpanClass,
        state.hoverTranslation,
        state.inDetails,
    ]);

    // Also recalculate position if the bubble resizes due to responsive wrapping or font metrics.
    useEffect(() => {
        if (disabled || typeof ResizeObserver === 'undefined') return;
        const el = bubbleRef.current;
        if (!el) return;
        let prevW = el.offsetWidth;
        let prevH = el.offsetHeight;
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const nextW = Math.round(entry.contentRect.width);
            const nextH = Math.round(entry.contentRect.height);
            if (nextW === prevW && nextH === prevH) return;
            prevW = nextW;
            prevH = nextH;
            repositionBubble();
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [disabled, repositionBubble]);

    if (disabled) return null;

    const hasActiveStyle = !!(
        state.styledBlockClass ||
        state.styledSpanClass ||
        state.hoverTranslation !== null ||
        state.inDetails
    );

    return (
        <BubbleMenu
            pluginKey={bubblePluginKey}
            editor={editor}
            updateDelay={50}
            options={BUBBLE_FLOATING_OPTIONS}
            style={BUBBLE_CONTAINER_STYLE}
            shouldShow={shouldShowSelectionBubble}
        >
            <div
                ref={bubbleRef}
                className={'tiptap-bubble-menu' + (expanded ? ' is-expanded' : '')}
                role="toolbar"
                aria-label="Selection formatting"
            >
                <div className="i-bubble-row">
                    <ToolbarButton
                        label="Style or template selection"
                        active={hasActiveStyle}
                        onClick={(e) => onOpenStyles(e.currentTarget)}
                    >
                        ✦ Style
                    </ToolbarButton>
                    <span className="i-sep" aria-hidden="true" />
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
                    <span className="i-bubble-expand">
                        <span className="i-sep" aria-hidden="true" />
                        <button
                            type="button"
                            className={'i-tool-btn i-chevron-btn' + (expanded ? ' is-open' : '')}
                            aria-label={
                                expanded
                                    ? 'Collapse formatting options'
                                    : 'Expand all formatting options'
                            }
                            aria-expanded={expanded}
                            title={expanded ? 'Show fewer options' : 'Show all formatting options'}
                            onMouseDown={preventFocusSteal}
                            onClick={() => setExpanded((v) => !v)}
                        >
                            <svg
                                viewBox="0 0 12 12"
                                width="12"
                                height="12"
                                aria-hidden="true"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.75"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M2.5 4.25L6 7.75L9.5 4.25" />
                            </svg>
                        </button>
                    </span>
                </div>

                {expanded ? (
                    <>
                        <div className="i-bubble-row">
                            <BlockStyleButton
                                blockStyle={state.blockStyle}
                                onClick={(el) => onOpenBlockStyle(el)}
                            />
                            <span className="i-sep" aria-hidden="true" />
                            <ToolbarButton
                                label="Subscript"
                                active={state.subscript}
                                onClick={() => editor.chain().focus().toggleSubscript().run()}
                            >
                                x<sub>2</sub>
                            </ToolbarButton>
                            <ToolbarButton
                                label="Superscript"
                                active={state.superscript}
                                onClick={() => editor.chain().focus().toggleSuperscript().run()}
                            >
                                x<sup>2</sup>
                            </ToolbarButton>
                            <ToolbarButton
                                label="Text and highlight color"
                                active={!!state.color || !!state.backgroundColor}
                                onClick={(e) => onOpenColor(e.currentTarget)}
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
                                label="Insert image"
                                onClick={(e) => onOpenImage(e.currentTarget)}
                            >
                                Img
                            </ToolbarButton>
                            <span className="i-sep" aria-hidden="true" />
                            <ToolbarButton
                                label="Blockquote"
                                active={state.blockquote}
                                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                            >
                                “”
                            </ToolbarButton>
                            <ToolbarButton
                                label="Bulleted list"
                                active={state.bulletList}
                                onClick={() => editor.chain().focus().toggleBulletList().run()}
                            >
                                • List
                            </ToolbarButton>
                            <ToolbarButton
                                label="Numbered list"
                                active={state.orderedList}
                                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                            >
                                1. List
                            </ToolbarButton>
                            <ToolbarButton
                                label="Horizontal rule"
                                onClick={() => editor.chain().focus().setHorizontalRule().run()}
                            >
                                ―
                            </ToolbarButton>
                        </div>

                        <div className="i-bubble-row">
                            <ToolbarButton
                                label="Align left"
                                active={state.alignLeft}
                                onClick={() => editor.chain().focus().setTextAlign('left').run()}
                            >
                                ⇤
                            </ToolbarButton>
                            <ToolbarButton
                                label="Align center"
                                active={state.alignCenter}
                                onClick={() => editor.chain().focus().setTextAlign('center').run()}
                            >
                                ↔
                            </ToolbarButton>
                            <ToolbarButton
                                label="Align right"
                                active={state.alignRight}
                                onClick={() => editor.chain().focus().setTextAlign('right').run()}
                            >
                                ⇥
                            </ToolbarButton>
                            <ToolbarButton
                                label="Justify"
                                active={state.alignJustify}
                                onClick={() => editor.chain().focus().setTextAlign('justify').run()}
                            >
                                ≡
                            </ToolbarButton>
                            <ToolbarButton
                                label="Right-to-left"
                                active={state.dir === 'rtl'}
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
                                disabled={!state.canUndo}
                                onClick={() => editor.chain().focus().undo().run()}
                            >
                                ↶
                            </ToolbarButton>
                            <ToolbarButton
                                label="Redo"
                                disabled={!state.canRedo}
                                onClick={() => editor.chain().focus().redo().run()}
                            >
                                ↷
                            </ToolbarButton>
                            {onInsertChapterBreak ? (
                                <>
                                    <span className="i-sep" aria-hidden="true" />
                                    <ToolbarButton
                                        label="Insert chapter break"
                                        onClick={onInsertChapterBreak}
                                    >
                                        + Break
                                    </ToolbarButton>
                                </>
                            ) : null}
                            <ActiveStyleChips
                                editor={editor}
                                state={state}
                                customPieces={customPieces}
                                onEditTranslate={onOpenTranslate}
                            />
                        </div>
                    </>
                ) : null}
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
    anchor: PopoverAnchor;
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
        <DirPopover portal anchor={anchor} open={open} onClose={onClose}>
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
    anchor: PopoverAnchor;
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
        <DirPopover portal anchor={anchor} open={open} onClose={onClose}>
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
    anchor: PopoverAnchor;
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
        <DirPopover portal anchor={anchor} open={open} onClose={onClose}>
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
                    <Checkbox
                        checked={useRp}
                        onChange={(checked) => setUseRp(checked)}
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

function TranslatePopover({
    editor,
    anchor,
    onApply,
    onRemove,
    onClose,
}: {
    editor: Editor;
    anchor: PopoverAnchor;
    onApply: (attrs: HoverTranslationAttrs) => void;
    onRemove: () => void;
    onClose: () => void;
}) {
    const open = !!anchor;
    const [original, setOriginal] = useState('');
    const [translation, setTranslation] = useState('');
    const [includeParens, setIncludeParens] = useState(true);
    const [editing, setEditing] = useState(false);
    const [error, setError] = useState('');
    const originalRef = useRef<HTMLInputElement>(null);
    const translationRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        const selected = getSelectedHoverTranslation(editor);
        if (selected) {
            setOriginal(selected.original);
            setTranslation(selected.translation);
            setIncludeParens(selected.includeParens);
            setEditing(true);
        } else {
            const { from, to } = editor.state.selection;
            const text = from !== to ? editor.state.doc.textBetween(from, to, ' ') : '';
            setOriginal(text);
            setTranslation('');
            setIncludeParens(true);
            setEditing(false);
        }
        setError('');
    }, [open, editor]);

    useFocusWhenShown(open, () => (original ? translationRef.current : originalRef.current));

    const apply = (e: React.FormEvent) => {
        e.preventDefault();
        if (!original.trim() || !translation.trim()) {
            setError('Both original text and translation are required.');
            return;
        }
        onApply({ original, translation, includeParens });
        onClose();
    };

    return (
        <DirPopover portal anchor={anchor} open={open} onClose={onClose}>
            <form
                className="tiptap-popover-form tiptap-translate-popover"
                aria-label="Translate on hover"
                onSubmit={apply}
            >
                <label className="i-field">
                    <span>Original text</span>
                    <input
                        ref={originalRef}
                        type="text"
                        placeholder="e.g. Je t’aime"
                        value={original}
                        onChange={(e) => {
                            setOriginal(e.target.value);
                            setError('');
                        }}
                    />
                </label>
                <label className="i-field">
                    <span>Translation (shown on hover)</span>
                    <input
                        ref={translationRef}
                        type="text"
                        placeholder="e.g. I love you"
                        value={translation}
                        onChange={(e) => {
                            setTranslation(e.target.value);
                            setError('');
                        }}
                    />
                </label>
                <label className="i-checkbox">
                    <Checkbox
                        checked={includeParens}
                        onChange={(checked) => setIncludeParens(checked)}
                    />
                    <span>Show (translation) fallback when styles are off</span>
                </label>
                {error ? <p className="i-error">{error}</p> : null}
                <div className="i-actions">
                    {editing ? (
                        <button
                            type="button"
                            onClick={() => {
                                onRemove();
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
    onClose,
}: {
    editor: Editor;
    anchor: PopoverAnchor;
    onClose: () => void;
}) {
    const open = !!anchor;
    return (
        <DirPopover portal anchor={anchor} open={open} onClose={onClose}>
            {open ? <ColorPopoverContent editor={editor} onClose={onClose} /> : null}
        </DirPopover>
    );
}

function ColorPopoverContent({ editor, onClose }: { editor: Editor; onClose: () => void }) {
    // Which custom color picker is open under its swatches.
    const [custom, setCustom] = useState<'text' | 'highlight' | null>(null);
    const { color, backgroundColor } = useEditorState({
        editor,
        selector: ({ editor: e }) => {
            const attrs = e.getAttributes('textStyle') as {
                color?: string;
                backgroundColor?: string;
            };
            return {
                color: attrs.color ?? '',
                backgroundColor: attrs.backgroundColor ?? '',
            };
        },
    });

    return (
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
                    <button
                        type="button"
                        className="i-custom-color"
                        title="Custom text color"
                        aria-label="Custom text color"
                        aria-expanded={custom === 'text'}
                        onClick={() => setCustom(custom === 'text' ? null : 'text')}
                    >
                        +
                    </button>
                </div>
                {custom === 'text' ? (
                    <ColorPickerPanel
                        className="i-inline-picker"
                        value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#870000'}
                        // Not focusing the editor, so the hex field keeps focus while typing.
                        onChange={(hex) => editor.chain().setColor(hex).run()}
                        onDone={onClose}
                    />
                ) : null}
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
                            className={'i-swatch' + (backgroundColor === hex ? ' is-active' : '')}
                            style={{ backgroundColor: hex }}
                            aria-label={`Highlight color ${hex}`}
                            title={hex}
                            onClick={() => {
                                editor.chain().focus().setBackgroundColor(hex).run();
                                onClose();
                            }}
                        />
                    ))}
                    <button
                        type="button"
                        className="i-custom-color"
                        title="Custom highlight color"
                        aria-label="Custom highlight color"
                        aria-expanded={custom === 'highlight'}
                        onClick={() => setCustom(custom === 'highlight' ? null : 'highlight')}
                    >
                        +
                    </button>
                </div>
                {custom === 'highlight' ? (
                    <ColorPickerPanel
                        className="i-inline-picker"
                        value={
                            /^#[0-9a-f]{6}$/i.test(backgroundColor) ? backgroundColor : '#fff59d'
                        }
                        onChange={(hex) => editor.chain().setBackgroundColor(hex).run()}
                        onDone={onClose}
                    />
                ) : null}
            </div>
        </div>
    );
}

const INLINE_PIECES = CSS_PIECES.filter((p) => p.kind === 'inline');
const BLOCK_PIECES = CSS_PIECES.filter((p) => p.kind === 'block');
const TEMPLATE_PIECES = CSS_PIECES.filter((p) => p.kind === 'template');

function pieceCredit(piece: CssPiece): string {
    if (!piece.custom) return '';
    return [piece.pack, piece.author ? `by ${piece.author}` : ''].filter(Boolean).join(' · ');
}

function StylesPopover({
    editor,
    anchor,
    workClasses,
    customPieces,
    onApplyPiece,
    onApplyCustomClass,
    onOpenTranslate,
    onOpenStyleManager,
    onClose,
}: {
    editor: Editor;
    anchor: PopoverAnchor;
    workClasses: readonly string[];
    customPieces: readonly CssPiece[];
    onApplyPiece: (piece: CssPiece) => void;
    onApplyCustomClass: (className: string, target: 'inline' | 'block') => void;
    onOpenTranslate: () => void;
    onOpenStyleManager: (tab: StyleLibraryTab, editId?: string | null) => void;
    onClose: () => void;
}) {
    const open = !!anchor;
    const [customClass, setCustomClass] = useState('');
    const [filter, setFilter] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setFilter('');
        setCustomClass('');
    }, [open]);

    useFocusWhenShown(open, () => searchRef.current);

    const activeBlockClass = open
        ? (editor.getAttributes('styledBlock').class as string | null) ?? ''
        : '';
    const activeSpanClass = open
        ? (editor.getAttributes('styledSpan').class as string | null) ?? ''
        : '';
    const hasActiveHoverTranslation = open && getSelectedHoverTranslation(editor) !== null;
    const hasSelection = open && !editor.state.selection.empty;

    const query = filter.trim().toLowerCase();
    const matches = (piece: CssPiece) =>
        !query ||
        piece.label.toLowerCase().includes(query) ||
        piece.description.toLowerCase().includes(query) ||
        piece.className.toLowerCase().includes(query) ||
        (piece.pack?.toLowerCase().includes(query) ?? false) ||
        (piece.author?.toLowerCase().includes(query) ?? false);

    const inlineItems = [
        ...INLINE_PIECES,
        ...customPieces.filter((p) => p.kind === 'inline'),
    ].filter(matches);
    const blockItems = [...BLOCK_PIECES, ...customPieces.filter((p) => p.kind === 'block')].filter(
        matches
    );
    const templateItems = [
        ...TEMPLATE_PIECES,
        ...customPieces.filter((p) => p.kind === 'template'),
    ].filter(matches);
    const matchingWorkClasses = workClasses.filter(
        (cls) => !query || cls.toLowerCase().includes(query)
    );

    const pickPiece = (piece: CssPiece) => {
        if (piece.id === 'translate') {
            onOpenTranslate();
            return;
        }
        onApplyPiece(piece);
        onClose();
    };

    const submitCustom = (target: 'inline' | 'block') => {
        const clean = customClass.replace(/^\.+/, '').trim();
        if (!clean) return;
        onApplyCustomClass(clean, target);
        onClose();
    };

    const renderPieceButton = (piece: CssPiece, active = false) => {
        const credit = pieceCredit(piece);
        return (
            <button
                key={piece.id}
                type="button"
                className={'i-piece-btn' + (active ? ' is-active' : '')}
                title={piece.description}
                onClick={() => pickPiece(piece)}
            >
                {piece.custom ? (
                    <StyleSwatch piece={piece} mode="compact" />
                ) : (
                    <span className={`i-piece-swatch is-${piece.id}`}>{piece.previewSample}</span>
                )}
                <span className="i-piece-meta">
                    <span className="i-piece-name">{piece.label}</span>
                    <span className="i-piece-desc">{piece.description}</span>
                    {credit ? <span className="i-piece-credit">{credit}</span> : null}
                </span>
            </button>
        );
    };

    return (
        <DirPopover portal anchor={anchor} open={open} onClose={onClose}>
            <div
                className="tiptap-styles-popover"
                role="dialog"
                aria-label="CSS pieces and templates"
            >
                <div className="i-styles-search">
                    <input
                        ref={searchRef}
                        type="search"
                        placeholder="Filter pieces & classes…"
                        aria-label="Filter CSS pieces and classes"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                    <div className="i-styles-actions">
                        <button
                            type="button"
                            onClick={() => onOpenStyleManager('import')}
                            title="Import a shared .eo3styles.json style pack"
                        >
                            Import…
                        </button>
                        <button
                            type="button"
                            onClick={() => onOpenStyleManager('create')}
                            title="Create a custom style or export a shareable .eo3styles.json pack"
                        >
                            + Create / Export
                        </button>
                        {customPieces.length ? (
                            <button
                                type="button"
                                onClick={() => onOpenStyleManager('library')}
                                title="Manage or export your custom styles"
                            >
                                Manage ({customPieces.length})
                            </button>
                        ) : null}
                    </div>
                </div>

                <div className="i-styles-scroll">
                    {inlineItems.length ? (
                        <section className="i-styles-group">
                            <h4>Inline styles</h4>
                            <div className="i-piece-grid">
                                {inlineItems.map((piece) => {
                                    const active =
                                        piece.id === 'translate'
                                            ? hasActiveHoverTranslation
                                            : activeSpanClass
                                                  .split(/\s+/)
                                                  .includes(piece.className);
                                    return renderPieceButton(piece, active);
                                })}
                            </div>
                        </section>
                    ) : null}

                    {blockItems.length ? (
                        <section className="i-styles-group">
                            <h4>Block wrappers</h4>
                            <div className="i-piece-grid">
                                {blockItems.map((piece) => {
                                    const active = activeBlockClass
                                        .split(/\s+/)
                                        .includes(piece.className);
                                    return renderPieceButton(piece, active);
                                })}
                            </div>
                        </section>
                    ) : null}

                    {templateItems.length ? (
                        <section className="i-styles-group">
                            <h4>
                                Selection templates
                                {hasSelection ? (
                                    <span className="i-hint"> · uses selection</span>
                                ) : null}
                            </h4>
                            <div className="i-piece-grid">
                                {templateItems.map((piece) => renderPieceButton(piece))}
                            </div>
                        </section>
                    ) : null}

                    {matchingWorkClasses.length ? (
                        <section className="i-styles-group">
                            <h4>From this work’s CSS</h4>
                            <div className="i-work-classes">
                                {matchingWorkClasses.map((cls) => (
                                    <div key={cls} className="i-work-class-row">
                                        <code>.{cls}</code>
                                        <span className="i-work-class-actions">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onApplyCustomClass(cls, 'inline');
                                                    onClose();
                                                }}
                                            >
                                                Inline
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onApplyCustomClass(cls, 'block');
                                                    onClose();
                                                }}
                                            >
                                                Block
                                            </button>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}

                    {!inlineItems.length &&
                    !blockItems.length &&
                    !templateItems.length &&
                    !matchingWorkClasses.length ? (
                        <p className="i-styles-empty">No matching styles.</p>
                    ) : null}
                </div>

                <form
                    className="i-custom-class-bar"
                    onSubmit={(e) => {
                        e.preventDefault();
                        submitCustom(hasSelection ? 'inline' : 'block');
                    }}
                >
                    <input
                        type="text"
                        placeholder="Custom class (e.g. flashback)"
                        aria-label="Custom CSS class name"
                        value={customClass}
                        onChange={(e) => setCustomClass(e.target.value)}
                    />
                    <button
                        type="button"
                        disabled={!customClass.trim()}
                        onClick={() => submitCustom('inline')}
                        title="Apply as inline <span>"
                    >
                        Span
                    </button>
                    <button
                        type="button"
                        disabled={!customClass.trim()}
                        onClick={() => submitCustom('block')}
                        title="Wrap as block <div>"
                    >
                        Box
                    </button>
                </form>
            </div>
        </DirPopover>
    );
}
