import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnyModule, Document, JsonValue, ModuleGroup } from '../../document';
import {
    insertSourceLine,
    moveSourceLine,
    readSourceLines,
    removeSourceLine,
    replaceSourceLine,
    SourceLineKind,
    sourceLineKind,
} from '../../editor/source-lines';
import { constrainNumber, settingType } from '../../plugins/source/settings-values';
import { renderAo3Preview } from '../../targets/ao3/render';
import { DirPopover } from '../../uikit/dir-popover';
import { Select } from '../../uikit/select';
import { RenderContext } from '../render-context';
import { EditIcon } from './icons';
import { RichEditor } from './rich-editor';
import type { RichTextAutoFocus } from './tiptap-rich-editor';
import {
    annotateInteractivePreview,
    cleanEditableRichHtml,
    cleanRichPartHtml,
    editableModeOf,
    editSourceLines,
    findHtmlSourceModule,
    findLineElement,
    findNamedInputModule,
    findSettingsField,
    lineParts,
    isRichPart,
    lineContent,
    richPartHtml,
    stampRichParts,
    parsePartOptions,
    PartOption,
    partLabel,
    partName,
    partValue,
    resolveLine,
    stampEditableSlots,
    TextHelpMetadata,
    updateSettingsFieldValue,
    updateTextModuleContents,
    writeEditableSlot,
} from './inline-template-helpers';

export interface InlinePreviewIslandProps {
    document: Document;
    group?: ModuleGroup;
    module?: AnyModule;
    name: string;
    rawHtml: string;
    editor?: React.ReactNode;
    renderEditor?: () => React.ReactNode;
    showReorder: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRemove: () => void;
}

interface CleanupOptions {
    /** True when transitioning directly to another editable slot in the same island. */
    handoff?: boolean;
}

interface ActiveDomEdit {
    kind: 'editable' | 'field' | 'input' | 'part';
    el: HTMLElement;
    cleanup: (options?: CleanupOptions) => void;
}

interface ActivateOptions {
    fromMouseDown?: boolean;
    selectAll?: boolean;
    /** Where to put the caret in a line part. */
    caret?: 'start' | 'end';
    /** The point clicked, to put the caret there once a rich part's editor opens. */
    point?: { x: number; y: number };
}

/** A rich line part being edited with eo3's rich text editor, mounted inside the part. */
interface ActiveRichPart {
    host: HTMLElement;
    html: string;
    autoFocus: RichTextAutoFocus;
    onChange: (html: string) => void;
    onKeyDown: (event: KeyboardEvent) => boolean;
}

/** A source line of a text input, shown by a `[data-edit-line]` element. */
interface LineRef {
    moduleId: string;
    index: number;
}

/** A line part to focus once the next render shows it (after Enter or Backspace). */
interface PendingFocus extends LineRef {
    part: string;
    caret: 'start' | 'end';
    /** Text the part should show, so an older render isn't mistaken for the new one. */
    expect?: string;
    until: number;
}

interface LineChoice {
    name: string;
    label: string;
    value: string;
    options: PartOption[];
}

/**
 * Splits a plain part's text at the caret (the end when the caret is elsewhere). Splitting
 * between words leaves no stray space on either side.
 */
function splitTextAtCaret(el: HTMLElement): { before: string; after: string } {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const before = document.createRange();
    before.selectNodeContents(el);
    const after = document.createRange();
    after.selectNodeContents(el);
    if (range && el.contains(range.startContainer)) {
        before.setEnd(range.startContainer, range.startOffset);
        after.setStart(range.startContainer, range.startOffset);
    } else {
        after.collapse(false);
    }
    const flat = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ');
    return { before: flat(before.toString()).trimEnd(), after: flat(after.toString()).trimStart() };
}

function htmlText(html: string): string {
    const box = document.createElement('div');
    box.innerHTML = html;
    return (box.textContent ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

function placeCaret(el: HTMLElement, at: 'start' | 'end'): void {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(at === 'start');
    selection.removeAllRanges();
    selection.addRange(range);
}

function sourceLineCount(doc: Document, moduleId: string): number {
    const mod = doc.findModule(moduleId);
    const data = mod?.data as { contents?: unknown; language?: string } | null | undefined;
    return readSourceLines(String(data?.contents ?? ''), sourceLineKind(data?.language)).length;
}

interface ActiveInputPortal {
    container: HTMLElement;
    moduleId: string;
    label: string;
    initialValue: string;
    help?: TextHelpMetadata;
}

const INLINE_DEBOUNCE_MS = 120;

const INLINE_FORMAT_TAGS = new Set([
    'A',
    'B',
    'CODE',
    'DEL',
    'EM',
    'I',
    'INS',
    'S',
    'SMALL',
    'STRONG',
    'SUB',
    'SUP',
    'U',
]);

let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureContext(): CanvasRenderingContext2D | null {
    if (measureCtx !== undefined) return measureCtx;
    if (
        typeof document === 'undefined' ||
        (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent))
    ) {
        measureCtx = null;
        return null;
    }
    try {
        measureCtx = document.createElement('canvas').getContext('2d');
    } catch {
        measureCtx = null;
    }
    return measureCtx;
}

function applyTextTransform(text: string, transform: string): string {
    if (transform === 'uppercase') return text.toUpperCase();
    if (transform === 'lowercase') return text.toLowerCase();
    return text;
}

function measureTextPx(text: string, styleEl: HTMLElement): number {
    const ctx = getMeasureContext();
    if (!ctx || typeof window === 'undefined' || !window.getComputedStyle) return 0;
    const style = window.getComputedStyle(styleEl);
    const font =
        style.font && style.font.trim()
            ? style.font
            : `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${
                  style.fontSize || '14px'
              } ${style.fontFamily || 'sans-serif'}`;
    ctx.font = font;
    const sample = applyTextTransform(text, style.textTransform || 'none');
    const metrics = ctx.measureText(sample);
    if (!Number.isFinite(metrics.width) || metrics.width <= 0) return 0;
    const letterSpacing = parseFloat(style.letterSpacing || '0');
    const extraSpacing =
        Number.isFinite(letterSpacing) && letterSpacing !== 0 && sample.length > 1
            ? letterSpacing * (sample.length - 1)
            : 0;
    return metrics.width + extraSpacing;
}

function measureLeadingNodesWidth(el: HTMLElement, firstStructuralChild?: ChildNode): number {
    if (typeof document === 'undefined') return 0;
    try {
        if (!firstStructuralChild) {
            return el.getBoundingClientRect().width;
        }
        const range = document.createRange();
        range.setStart(el, 0);
        range.setEndBefore(firstStructuralChild);
        return range.getBoundingClientRect().width;
    } catch {
        return 0;
    }
}

function sizeInlineInput(
    input: HTMLInputElement,
    styleEl: HTMLElement,
    initialMeasuredPx = 0
): void {
    const text = input.value || input.placeholder || '   ';
    const px = measureTextPx(text, styleEl);
    if (px > 0 || initialMeasuredPx > 0) {
        const targetPx = Math.ceil(Math.max(px + 8, initialMeasuredPx + 4, 28));
        input.style.width = `${targetPx}px`;
        return;
    }
    const len = Math.max(input.value.length, input.placeholder.length, 3);
    input.style.width = `${Math.min(len + 1.5, 60)}ch`;
}

function sizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(textarea.scrollHeight, 36)}px`;
}

function selectAllEditableContent(el: HTMLElement): void {
    if (typeof window === 'undefined' || !window.getSelection) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
}

/**
 * Renders a ready-made block or custom/raw-HTML module as a live AO3 preview island inside the
 * chapter. Templates that mark regions with `data-edit`, `data-edit-field`, or `data-edit-input`
 * can be edited directly in-place inside the styled preview, while the compact floating pill bar
 * still opens the full input/code popover when needed.
 */
export const InlinePreviewIsland = memo(function InlinePreviewIsland({
    document: doc,
    group,
    module,
    name,
    rawHtml,
    editor,
    renderEditor,
    showReorder,
    canMoveUp,
    canMoveDown,
    onMoveUp,
    onMoveDown,
    onRemove,
}: InlinePreviewIslandProps) {
    const { renderNow } = useContext(RenderContext);
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [inlineEditing, setInlineEditing] = useState(false);
    const [activeInput, setActiveInput] = useState<ActiveInputPortal | null>(null);
    const [activeRich, setActiveRich] = useState<ActiveRichPart | null>(null);
    const richEditorRef = useRef<RichEditor>(null);

    // Once a rich part's editor has unmounted, take away the container it mounted in, so the
    // part is left as the template drew it (an emptied part must stay `:empty` to be clickable).
    useEffect(() => {
        if (!activeRich) return;
        const { host } = activeRich;
        return () => host.remove();
    }, [activeRich]);
    const [syncTick, setSyncTick] = useState(0);

    const islandRef = useRef<HTMLDivElement>(null);
    const editBtnRef = useRef<HTMLButtonElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const activeEditRef = useRef<ActiveDomEdit | null>(null);
    const handoffInProgressRef = useRef(false);
    const handledMouseDownElRef = useRef<HTMLElement | null>(null);
    const lastAppliedHtmlRef = useRef<string | null>(null);
    const lastSyncTickRef = useRef(-1);
    const updatingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const draftFlushRef = useRef<(() => boolean) | null>(null);
    const pendingFocusRef = useRef<PendingFocus | null>(null);
    const lineBarRef = useRef<HTMLDivElement>(null);
    const choiceSelectRefs = useRef(new Map<string, HTMLSelectElement>());
    const [barLine, setBarLine] = useState<LineRef | null>(null);
    const [barPos, setBarPos] = useState<{ top: number; left: number } | null>(null);
    const [barChoices, setBarChoices] = useState<LineChoice[]>([]);
    const [choiceFocus, setChoiceFocus] = useState<{ name: string; tick: number } | null>(null);

    const previewHtml = useMemo(
        () =>
            rawHtml.trim()
                ? renderAo3Preview(stampRichParts(stampEditableSlots(rawHtml))).html
                : '',
        [rawHtml]
    );

    // Keep latest props available to imperative DOM event handlers without re-binding listeners.
    const docRef = useRef(doc);
    docRef.current = doc;
    const groupRef = useRef(group);
    groupRef.current = group;
    const moduleRef = useRef(module);
    moduleRef.current = module;
    const renderNowRef = useRef(renderNow);
    renderNowRef.current = renderNow;

    // Sync rendered AO3 HTML into the live preview DOM whenever no inline edit is actively locked.
    useEffect(() => {
        const container = previewRef.current;
        if (!container) {
            lastAppliedHtmlRef.current = null;
            return;
        }
        if (activeEditRef.current || handoffInProgressRef.current) return;

        const htmlChanged = lastAppliedHtmlRef.current !== previewHtml;
        const tickChanged = lastSyncTickRef.current !== syncTick;
        if (!htmlChanged && !tickChanged) return;

        if (htmlChanged) {
            if (updatingTimeoutRef.current) {
                clearTimeout(updatingTimeoutRef.current);
                updatingTimeoutRef.current = null;
            }
            container.innerHTML = previewHtml;
            lastAppliedHtmlRef.current = previewHtml;
        }
        lastSyncTickRef.current = syncTick;
        annotateInteractivePreview(container, docRef.current, groupRef.current, moduleRef.current);

        // After Enter/Backspace in a line, continue typing in the line the new render shows.
        const pending = pendingFocusRef.current;
        if (pending && htmlChanged) {
            const line = findLineElement(
                container,
                docRef.current,
                groupRef.current,
                pending.moduleId,
                pending.index
            );
            const textParts = line
                ? lineParts(line).filter((p) => p.getAttribute('data-edit-interactive') === 'part')
                : [];
            const part = textParts.find((p) => partName(p) === pending.part) ?? textParts[0];
            const shows =
                part &&
                (pending.expect === undefined ||
                    (part.textContent ?? '').trim() === pending.expect.trim());
            if (part && shows) {
                pendingFocusRef.current = null;
                setBarLine({ moduleId: pending.moduleId, index: pending.index });
                activateRef.current(part, { caret: pending.caret });
            } else if (Date.now() > pending.until) {
                pendingFocusRef.current = null;
            }
        }
    }, [previewHtml, syncTick, doc, group, module]);

    // Keep the line toolbar beside its line and in step with the line's choices.
    useEffect(() => {
        const island = islandRef.current;
        const container = previewRef.current;
        const line =
            barLine && container
                ? findLineElement(
                      container,
                      docRef.current,
                      groupRef.current,
                      barLine.moduleId,
                      barLine.index
                  )
                : null;
        if (!line || !island) {
            setBarPos(null);
            setBarChoices([]);
            return;
        }
        const lineRect = line.getBoundingClientRect();
        const islandRect = island.getBoundingClientRect();
        // Above the line's start: the block's own control pill sits at the top right.
        setBarPos({
            top: lineRect.top - islandRect.top,
            left: Math.max(0, lineRect.left - islandRect.left),
        });
        setBarChoices(
            lineParts(line).flatMap((part) => {
                const options = parsePartOptions(part.getAttribute('data-edit-options'));
                return options
                    ? [
                          {
                              name: partName(part),
                              label: partLabel(part),
                              value: partValue(part),
                              options,
                          },
                      ]
                    : [];
            })
        );
    }, [barLine, previewHtml, syncTick, inlineEditing]);

    useEffect(() => {
        if (!choiceFocus) return;
        const select = choiceSelectRefs.current.get(choiceFocus.name);
        if (!select) return; // not shown yet; try again once the toolbar has its choices
        select.focus();
        setChoiceFocus(null);
    }, [choiceFocus, barChoices]);

    // Flush & tear down any active inline edit on unmount.
    useEffect(() => {
        return () => {
            if (updatingTimeoutRef.current) {
                clearTimeout(updatingTimeoutRef.current);
                updatingTimeoutRef.current = null;
            }
            activeEditRef.current?.cleanup({ handoff: true });
            activeEditRef.current = null;
        };
    }, []);

    const closeInputPortal = useCallback(() => {
        if (activeEditRef.current?.kind === 'input') {
            activeEditRef.current.cleanup();
        }
    }, []);

    const activateRef = useRef<(el: HTMLElement, opts?: ActivateOptions) => void>(() => {});

    const navigateFrom = useCallback((currentEl: HTMLElement, direction: 1 | -1): boolean => {
        const container = previewRef.current;
        if (!container) return false;
        // Choices live in the line toolbar, so Tab moves between things typed in place.
        const list = Array.from(
            container.querySelectorAll<HTMLElement>(
                '[data-edit-interactive]:not([data-edit-interactive="choice"])'
            )
        );
        const idx = list.indexOf(currentEl);
        if (idx === -1) return false;
        const nextIdx = idx + direction;
        if (nextIdx < 0 || nextIdx >= list.length) return false;
        const nextEl = list[nextIdx];
        handoffInProgressRef.current = true;
        try {
            activeEditRef.current?.cleanup({ handoff: true });
            activateRef.current(nextEl, { selectAll: true });
        } finally {
            handoffInProgressRef.current = false;
        }
        return true;
    }, []);

    const startEditableSlot = useCallback(
        (el: HTMLElement, opts?: { fromMouseDown?: boolean; selectAll?: boolean }) => {
            const htmlMod = findHtmlSourceModule(
                docRef.current,
                groupRef.current,
                moduleRef.current
            );
            if (!htmlMod) return;
            const slotAttr = el.getAttribute('data-edit-slot-index');
            if (slotAttr === null) return;
            const slotIndex = Number(slotAttr);
            if (!Number.isInteger(slotIndex) || slotIndex < 0) return;

            const mode = editableModeOf(el);
            const originalDom = el.innerHTML;
            // The preview shows inline styles as generated classes; edit the template's own HTML
            // so saving (even without changes) keeps the styles.
            let swapped = false;
            if (mode === 'rich') {
                const source = cleanEditableRichHtml(richPartHtml(el), el.tagName);
                if (source.includes(' style=') && source !== el.innerHTML) {
                    el.innerHTML = source;
                    swapped = true;
                }
            }
            const originalText = el.textContent ?? '';
            const moduleId = htmlMod.id;
            // Escape restores this exactly, rather than re-deriving it from the preview DOM.
            const originalSource = String(
                (htmlMod.data as { contents?: unknown } | null)?.contents ?? ''
            );
            let timer: ReturnType<typeof setTimeout> | null = null;
            let reverted = false;
            let finished = false;

            const commitValue = (value: string) => {
                const currentMod = docRef.current.findModule(moduleId);
                if (!currentMod) return;
                const currentSource = String(
                    (currentMod.data as { contents?: unknown } | null)?.contents ?? ''
                );
                const nextSource = writeEditableSlot(currentSource, slotIndex, mode, value);
                if (nextSource !== currentSource) {
                    updateTextModuleContents(docRef.current, moduleId, nextSource);
                }
            };

            const flush = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                if (!reverted) {
                    commitValue(mode === 'rich' ? el.innerHTML : el.textContent ?? '');
                }
            };

            const onInput = () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(flush, INLINE_DEBOUNCE_MS);
            };

            const onKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    reverted = true;
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    if (mode === 'rich') el.innerHTML = originalDom;
                    else el.textContent = originalText;
                    updateTextModuleContents(docRef.current, moduleId, originalSource);
                    el.blur();
                    return;
                }
                if (e.key === 'Tab') {
                    const moved = navigateFrom(el, e.shiftKey ? -1 : 1);
                    if (moved) {
                        e.preventDefault();
                        return;
                    }
                }
                if (mode === 'text' && e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    el.blur();
                }
            };

            const onPaste = (e: ClipboardEvent) => {
                const clip = e.clipboardData;
                if (!clip) return;
                e.preventDefault();
                const selection = window.getSelection();
                if (!selection || !selection.rangeCount) return;
                const range = selection.getRangeAt(0);
                range.deleteContents();
                if (mode === 'rich') {
                    const rawClipHtml = clip.getData('text/html');
                    if (rawClipHtml) {
                        const cleaned = cleanEditableRichHtml(rawClipHtml, el.tagName);
                        const frag = document.createRange().createContextualFragment(cleaned);
                        range.insertNode(frag);
                        range.collapse(false);
                    } else {
                        const textNode = document.createTextNode(clip.getData('text/plain'));
                        range.insertNode(textNode);
                        range.setStartAfter(textNode);
                        range.collapse(true);
                    }
                } else {
                    const text = clip.getData('text/plain').replace(/\r?\n/g, ' ');
                    const textNode = document.createTextNode(text);
                    range.insertNode(textNode);
                    range.setStartAfter(textNode);
                    range.collapse(true);
                }
                selection.removeAllRanges();
                selection.addRange(range);
                onInput();
            };

            const finish = (cleanupOpts?: CleanupOptions) => {
                if (finished) return;
                finished = true;
                flush();
                el.removeEventListener('input', onInput);
                el.removeEventListener('keydown', onKeyDown);
                el.removeEventListener('paste', onPaste);
                el.removeEventListener('blur', onBlur);
                el.contentEditable = 'false';
                el.classList.remove('is-inline-editing');
                if (activeEditRef.current?.cleanup === finish) {
                    activeEditRef.current = null;
                }
                if (!cleanupOpts?.handoff) {
                    setInlineEditing(false);
                    setSyncTick((v) => v + 1);
                }
            };

            const onBlur = () => {
                if (handoffInProgressRef.current) return;
                finish();
            };

            activeEditRef.current = { kind: 'editable', el, cleanup: finish };
            setInlineEditing(true);
            el.contentEditable = 'true';
            el.classList.add('is-inline-editing');
            el.addEventListener('input', onInput);
            el.addEventListener('keydown', onKeyDown);
            el.addEventListener('paste', onPaste);
            el.addEventListener('blur', onBlur);

            if (opts?.fromMouseDown && !swapped) {
                // Letting native mousedown run places the caret at the exact clicked character;
                // ensure focus on the next frame in case the click was on an empty/padding edge.
                requestAnimationFrame(() => {
                    if (!finished && document.activeElement !== el) {
                        el.focus();
                    }
                });
            } else {
                el.focus();
                if (opts?.selectAll) {
                    selectAllEditableContent(el);
                } else if (swapped) {
                    // The swap replaced the clicked nodes, so the caret goes to the end.
                    placeCaret(el, 'end');
                }
            }
        },
        [navigateFrom]
    );

    const startSettingsField = useCallback(
        (el: HTMLElement, opts?: { selectAll?: boolean }) => {
            const key = el.getAttribute('data-edit-field') ?? '';
            const resolved = findSettingsField(docRef.current, groupRef.current, key);
            if (!resolved) return;

            const { module: settingsMod, field, value } = resolved;
            const type = settingType(field);
            const prefix = el.getAttribute('data-edit-prefix') ?? '';
            const initialValue = value;
            const initialStr = typeof value === 'string' ? value : String(value ?? '');

            // Detect whether `el` has trailing structural children (like `<br>` or `<span data-edit-field>`)
            // so we only replace the leading text nodes and leave child fields/lines intact.
            const firstStructuralChild = Array.from(el.childNodes).find(
                (node) =>
                    node.nodeType === Node.ELEMENT_NODE &&
                    !INLINE_FORMAT_TAGS.has((node as Element).tagName)
            );
            const initialWidthPx = Math.max(
                0,
                measureLeadingNodesWidth(el, firstStructuralChild) -
                    (prefix ? measureTextPx(prefix, el) : 0)
            );
            const savedLeadingNodes: ChildNode[] = [];
            const savedInnerHtml = el.innerHTML;

            let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
            if (type === 'choice') {
                const select = document.createElement('select');
                select.className = 'eo3-inline-field-input is-select';
                select.setAttribute('aria-label', field.label || field.key);
                for (const opt of field.options ?? []) {
                    const optionEl = document.createElement('option');
                    optionEl.value = opt;
                    optionEl.textContent = opt;
                    select.appendChild(optionEl);
                }
                select.value = initialStr;
                control = select;
            } else if (type === 'paragraph') {
                const textarea = document.createElement('textarea');
                textarea.className = 'eo3-inline-field-input is-multiline';
                textarea.setAttribute('aria-label', field.label || field.key);
                textarea.rows = 2;
                textarea.value = initialStr;
                control = textarea;
            } else {
                const input = document.createElement('input');
                input.type = type === 'number' ? 'number' : 'text';
                input.className = 'eo3-inline-field-input';
                input.setAttribute('aria-label', field.label || field.key);
                if (type === 'number') {
                    if (field.min !== undefined) input.min = String(field.min);
                    if (field.max !== undefined) input.max = String(field.max);
                    if (field.step !== undefined) input.step = String(field.step);
                }
                input.value = initialStr;
                input.placeholder = field.label || field.key;
                sizeInlineInput(input, el, initialWidthPx);
                control = input;
            }

            const prefixNode = prefix ? document.createTextNode(prefix) : null;
            if (firstStructuralChild) {
                while (el.firstChild && el.firstChild !== firstStructuralChild) {
                    const removed = el.removeChild(el.firstChild);
                    savedLeadingNodes.push(removed);
                }
                if (prefixNode) el.insertBefore(prefixNode, firstStructuralChild);
                el.insertBefore(control, firstStructuralChild);
            } else {
                el.textContent = '';
                if (prefixNode) el.appendChild(prefixNode);
                el.appendChild(control);
            }

            if (control instanceof HTMLTextAreaElement) {
                sizeTextarea(control);
            }

            let timer: ReturnType<typeof setTimeout> | null = null;
            let reverted = false;
            let finished = false;
            let dirty = false;

            const parseControlValue = (): JsonValue => {
                if (type === 'number') {
                    const n = Number(control.value);
                    return Number.isFinite(n) ? constrainNumber(field, n) : initialValue;
                }
                return control.value;
            };

            const commitNow = (val: JsonValue) => {
                updateSettingsFieldValue(docRef.current, settingsMod.id, field.key, val);
            };

            const onInput = () => {
                dirty = true;
                if (control instanceof HTMLInputElement) sizeInlineInput(control, el);
                if (control instanceof HTMLTextAreaElement) sizeTextarea(control);
                if (timer) clearTimeout(timer);
                const nextVal = parseControlValue();
                if (type === 'choice') {
                    commitNow(nextVal);
                    renderNowRef.current();
                } else {
                    timer = setTimeout(() => commitNow(nextVal), INLINE_DEBOUNCE_MS);
                }
            };

            const onKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    reverted = true;
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    if (dirty) {
                        commitNow(initialValue);
                        renderNowRef.current();
                    }
                    control.blur();
                    return;
                }
                if (e.key === 'Tab') {
                    const moved = navigateFrom(el, e.shiftKey ? -1 : 1);
                    if (moved) {
                        e.preventDefault();
                        return;
                    }
                }
                if (
                    e.key === 'Enter' &&
                    (!(control instanceof HTMLTextAreaElement) || e.ctrlKey || e.metaKey)
                ) {
                    e.preventDefault();
                    control.blur();
                }
            };

            const finish = (cleanupOpts?: CleanupOptions) => {
                if (finished) return;
                finished = true;
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                const committedVal = reverted ? initialValue : parseControlValue();
                const changed = !reverted && committedVal !== initialValue;
                if (!reverted) commitNow(committedVal);

                control.removeEventListener('input', onInput);
                control.removeEventListener('change', onInput);
                (control as HTMLElement).removeEventListener('keydown', onKeyDown);
                control.removeEventListener('blur', onBlur);
                el.classList.remove('is-inline-editing');

                // Immediately show the committed text in-place so there is zero flash before Svelte re-renders.
                if (reverted) {
                    if (firstStructuralChild) {
                        prefixNode?.remove();
                        control.remove();
                        for (const node of savedLeadingNodes) {
                            el.insertBefore(node, firstStructuralChild);
                        }
                    } else {
                        el.innerHTML = savedInnerHtml;
                    }
                } else {
                    const display = String(committedVal ?? '');
                    if (firstStructuralChild) {
                        prefixNode?.remove();
                        control.replaceWith(document.createTextNode(prefix + display));
                    } else {
                        el.textContent = prefix + display;
                    }
                }

                if (changed) {
                    renderNowRef.current();
                }

                if (activeEditRef.current?.cleanup === finish) {
                    activeEditRef.current = null;
                }
                if (!cleanupOpts?.handoff) {
                    setInlineEditing(false);
                    setSyncTick((v) => v + 1);
                }
            };

            const onBlur = () => {
                if (handoffInProgressRef.current) return;
                finish();
            };

            activeEditRef.current = { kind: 'field', el, cleanup: finish };
            setInlineEditing(true);
            el.classList.add('is-inline-editing');
            control.addEventListener('input', onInput);
            control.addEventListener('change', onInput);
            (control as HTMLElement).addEventListener('keydown', onKeyDown);
            control.addEventListener('blur', onBlur);
            control.focus();
            if (control instanceof HTMLInputElement && control.type === 'text') {
                if (opts?.selectAll) {
                    control.select();
                } else {
                    const end = control.value.length;
                    control.setSelectionRange(end, end);
                }
            }
        },
        [navigateFrom]
    );

    const startInputRegion = useCallback((el: HTMLElement) => {
        const inputName = el.getAttribute('data-edit-input') ?? '';
        const targetMod = findNamedInputModule(docRef.current, groupRef.current, inputName);
        if (!targetMod) return;

        const data = targetMod.data as { contents?: unknown; help?: TextHelpMetadata } | null;
        const initialValue = String(data?.contents ?? '');
        const inputEntry = groupRef.current?.inputs?.find((i) => i.moduleId === targetMod.id);
        const label = inputEntry?.label || targetMod.title || inputName || 'Text';

        let finished = false;
        const finish = (cleanupOpts?: CleanupOptions) => {
            if (finished) return;
            finished = true;
            const changed = draftFlushRef.current?.() ?? false;
            draftFlushRef.current = null;
            el.classList.remove('is-inline-input-editing');
            if (activeEditRef.current?.cleanup === finish) {
                activeEditRef.current = null;
            }
            setActiveInput(null);
            if (changed) {
                el.classList.add('is-inline-updating');
                if (updatingTimeoutRef.current) clearTimeout(updatingTimeoutRef.current);
                updatingTimeoutRef.current = setTimeout(() => {
                    el.classList.remove('is-inline-updating');
                    updatingTimeoutRef.current = null;
                }, 1500);
                renderNowRef.current();
            }
            if (!cleanupOpts?.handoff) {
                setInlineEditing(false);
                setSyncTick((v) => v + 1);
            }
        };

        activeEditRef.current = { kind: 'input', el, cleanup: finish };
        el.classList.add('is-inline-input-editing');
        setInlineEditing(true);
        setActiveInput({
            container: el,
            moduleId: targetMod.id,
            label,
            initialValue,
            help: data?.help,
        });
    }, []);

    /**
     * Edits a rich line part (`data-edit-mode="rich"`) with eo3's rich text editor, mounted in
     * the part, so its selection toolbar (styles, bold, links, ruby, colours…) is there. Each
     * change rewrites the source line as HTML; Enter splits the line at the caret, Backspace in
     * an empty line removes it. Clicking outside the part (not its toolbars) finishes.
     */
    const startRichLinePart = useCallback(
        (el: HTMLElement, opts?: ActivateOptions) => {
            const line = el.closest<HTMLElement>('[data-edit-line]');
            const resolved = line ? resolveLine(line, docRef.current, groupRef.current) : null;
            if (!line || !resolved) return;
            const moduleId = resolved.module.id;
            const index = resolved.index;
            const name = partName(el);
            // The template's own HTML: the preview shows inline styles as generated classes.
            const initialHtml = cleanRichPartHtml(richPartHtml(el));
            const originalSource = String(
                (resolved.module.data as { contents?: unknown } | null)?.contents ?? ''
            );
            let finished = false;
            /** Set once the edit is ending, so late editor updates don't write. */
            let closed = false;
            /** The source changed, so a render follows. */
            let touched = false;
            /** What the part shows after closing, until that render lands (null: as before). */
            let display: string | null = null;

            const writeLine = (edit: (source: string, kind: SourceLineKind) => string) => {
                if (editSourceLines(docRef.current, moduleId, edit)) touched = true;
            };

            const onChange = (html: string) => {
                if (closed) return;
                const value = cleanRichPartHtml(html);
                display = value;
                // Later edits to other parts of this line rebuild it from the edited HTML.
                el.setAttribute('data-edit-source', value);
                const content = lineContent(line, { [name]: value });
                writeLine((source, kind) => replaceSourceLine(source, kind, index, content));
            };

            const host = document.createElement('span');
            host.className = 'eo3-rich-part-host';
            // What the part showed, kept aside while the editor stands in for it. Moved into a
            // hidden wrapper: CSS can hide elements but not the bare text between them.
            const original = document.createElement('span');
            original.className = 'eo3-rich-part-original';
            original.hidden = true;

            const finish = (cleanupOpts?: CleanupOptions) => {
                if (finished) return;
                finished = true;
                richEditorRef.current?.flush();
                closed = true;
                document.removeEventListener('mousedown', onDocMouseDown, true);
                setActiveRich(null);
                // Show what was typed until the next render lands, or what was there before.
                original.remove();
                if (display !== null) host.insertAdjacentHTML('beforebegin', display);
                else host.before(...Array.from(original.childNodes));
                el.classList.remove('is-inline-editing', 'is-inline-rich-editing');
                if (activeEditRef.current?.cleanup === finish) {
                    activeEditRef.current = null;
                }
                if (touched) renderNowRef.current();
                if (!cleanupOpts?.handoff) {
                    setInlineEditing(false);
                    if (!touched) setSyncTick((v) => v + 1);
                }
            };

            const othersEmpty = () =>
                lineParts(line).every(
                    (part) =>
                        part === el ||
                        part.getAttribute('data-edit-interactive') !== 'part' ||
                        partValue(part) === ''
                );

            const onKeyDown = (event: KeyboardEvent): boolean => {
                if (event.isComposing) return false;
                if (event.key === 'Escape') {
                    closed = true;
                    display = null;
                    if (touched) updateTextModuleContents(docRef.current, moduleId, originalSource);
                    finish();
                    return true;
                }
                if (event.key === 'Tab') {
                    return navigateFrom(el, event.shiftKey ? -1 : 1);
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                    const split = richEditorRef.current?.splitAtSelection();
                    if (!split) return true;
                    const before = cleanRichPartHtml(split.before).replace(/(?:\s|&nbsp;)+$/, '');
                    const after = cleanRichPartHtml(split.after).replace(/^(?:\s|&nbsp;)+/, '');
                    const current = lineContent(line, { [name]: before });
                    const next = lineContent(line, { [name]: after });
                    const rewriteCurrent = touched || htmlText(after) !== '';
                    closed = true;
                    display = before;
                    writeLine((source, kind) =>
                        insertSourceLine(
                            rewriteCurrent
                                ? replaceSourceLine(source, kind, index, current)
                                : source,
                            kind,
                            index,
                            next
                        )
                    );
                    pendingFocusRef.current = {
                        moduleId,
                        index: index + 1,
                        part: name,
                        caret: 'start',
                        expect: htmlText(after),
                        until: Date.now() + 5000,
                    };
                    finish();
                    return true;
                }
                if (
                    event.key === 'Backspace' &&
                    (richEditorRef.current?.isEmpty() ?? false) &&
                    othersEmpty()
                ) {
                    closed = true;
                    display = null;
                    writeLine((source, kind) => removeSourceLine(source, kind, index));
                    pendingFocusRef.current =
                        index > 0
                            ? {
                                  moduleId,
                                  index: index - 1,
                                  part: name,
                                  caret: 'end',
                                  until: Date.now() + 5000,
                              }
                            : null;
                    finish();
                    return true;
                }
                return false;
            };

            // Focus moving into the editor's popovers (Link, Style…) must not end the edit, so
            // it ends on a click outside instead of on blur.
            const onDocMouseDown = (event: MouseEvent) => {
                const target = event.target as Element | null;
                if (!target || host.contains(target)) return;
                if (target.closest('.tiptap-bubble-menu, dialog')) return;
                const island = islandRef.current;
                // The island hands off to another editable piece, or runs a toolbar button.
                if (
                    island?.contains(target) &&
                    target.closest('[data-edit-interactive], .eo3-island-bar, .eo3-line-bar')
                ) {
                    return;
                }
                finish();
            };

            activeEditRef.current = { kind: 'part', el, cleanup: finish };
            setInlineEditing(true);
            setBarLine({ moduleId, index });
            el.classList.add('is-inline-editing', 'is-inline-rich-editing');
            original.append(...Array.from(el.childNodes));
            el.append(original, host);
            document.addEventListener('mousedown', onDocMouseDown, true);
            setActiveRich({
                host,
                html: initialHtml,
                autoFocus: opts?.point ?? opts?.caret ?? 'end',
                onChange,
                onKeyDown,
            });
        },
        [navigateFrom]
    );

    /**
     * Edits one plain part of a `[data-edit-line]` in place. Each change rewrites that source line
     * from the line's format; Enter splits the line in two, Backspace in an empty line removes it.
     */
    const startLinePart = useCallback(
        (el: HTMLElement, opts?: ActivateOptions) => {
            if (isRichPart(el)) {
                startRichLinePart(el, opts);
                return;
            }
            const line = el.closest<HTMLElement>('[data-edit-line]');
            const resolved = line ? resolveLine(line, docRef.current, groupRef.current) : null;
            if (!line || !resolved) return;
            const moduleId = resolved.module.id;
            const index = resolved.index;
            const name = partName(el);
            const originalDom = el.innerHTML;
            const originalSource = String(
                (resolved.module.data as { contents?: unknown } | null)?.contents ?? ''
            );
            let timer: ReturnType<typeof setTimeout> | null = null;
            let dirty = false;
            let reverted = false;
            let structural = false;
            let finished = false;

            const currentText = () => (el.textContent ?? '').replace(/\s*[\r\n]+\s*/g, ' ');
            const commit = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                if (!dirty || reverted) return;
                const content = lineContent(line, { [name]: currentText() });
                editSourceLines(docRef.current, moduleId, (source, kind) =>
                    replaceSourceLine(source, kind, index, content)
                );
            };

            const onInput = () => {
                dirty = true;
                if (timer) clearTimeout(timer);
                timer = setTimeout(commit, INLINE_DEBOUNCE_MS);
            };

            const finish = (cleanupOpts?: CleanupOptions) => {
                if (finished) return;
                finished = true;
                commit();
                el.removeEventListener('input', onInput);
                el.removeEventListener('keydown', onKeyDown);
                el.removeEventListener('paste', onPaste);
                el.removeEventListener('blur', onBlur);
                el.contentEditable = 'false';
                el.classList.remove('is-inline-editing');
                if (activeEditRef.current?.cleanup === finish) {
                    activeEditRef.current = null;
                }
                const changed = dirty || structural;
                if (changed) renderNowRef.current();
                if (!cleanupOpts?.handoff) {
                    setInlineEditing(false);
                    // A change brings a new render; without one, restore the rendered DOM now.
                    if (!changed) setSyncTick((v) => v + 1);
                }
            };

            const restructure = (
                edit: (source: string, kind: ReturnType<typeof sourceLineKind>) => string,
                focus: PendingFocus | null
            ) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                editSourceLines(docRef.current, moduleId, edit);
                pendingFocusRef.current = focus;
                dirty = false;
                structural = true;
                finish();
            };

            const onKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    reverted = true;
                    el.innerHTML = originalDom;
                    if (dirty) updateTextModuleContents(docRef.current, moduleId, originalSource);
                    finish();
                    el.blur();
                    return;
                }
                if (e.key === 'Tab') {
                    if (navigateFrom(el, e.shiftKey ? -1 : 1)) e.preventDefault();
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.isComposing) return;
                    const { before, after } = splitTextAtCaret(el);
                    const current = lineContent(line, { [name]: before });
                    const next = lineContent(line, { [name]: after });
                    const rewriteCurrent = dirty || after !== '';
                    el.textContent = before;
                    restructure(
                        (source, kind) =>
                            insertSourceLine(
                                rewriteCurrent
                                    ? replaceSourceLine(source, kind, index, current)
                                    : source,
                                kind,
                                index,
                                next
                            ),
                        {
                            moduleId,
                            index: index + 1,
                            part: name,
                            caret: 'start',
                            expect: after,
                            until: Date.now() + 5000,
                        }
                    );
                    return;
                }
                if (e.key === 'Backspace' && currentText() === '') {
                    const othersEmpty = lineParts(line).every(
                        (part) =>
                            part === el ||
                            part.getAttribute('data-edit-interactive') !== 'part' ||
                            partValue(part) === ''
                    );
                    if (!othersEmpty) return;
                    e.preventDefault();
                    restructure(
                        (source, kind) => removeSourceLine(source, kind, index),
                        index > 0
                            ? {
                                  moduleId,
                                  index: index - 1,
                                  part: name,
                                  caret: 'end',
                                  until: Date.now() + 5000,
                              }
                            : null
                    );
                }
            };

            const onPaste = (e: ClipboardEvent) => {
                const clip = e.clipboardData;
                if (!clip) return;
                e.preventDefault();
                const selection = window.getSelection();
                if (!selection || !selection.rangeCount) return;
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const textNode = document.createTextNode(
                    clip.getData('text/plain').replace(/\s*[\r\n]+\s*/g, ' ')
                );
                range.insertNode(textNode);
                range.setStartAfter(textNode);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                onInput();
            };

            const onBlur = () => {
                if (handoffInProgressRef.current) return;
                finish();
            };

            activeEditRef.current = { kind: 'part', el, cleanup: finish };
            setInlineEditing(true);
            setBarLine({ moduleId, index });
            el.contentEditable = 'true';
            el.classList.add('is-inline-editing');
            el.addEventListener('input', onInput);
            el.addEventListener('keydown', onKeyDown);
            el.addEventListener('paste', onPaste);
            el.addEventListener('blur', onBlur);

            if (opts?.fromMouseDown) {
                requestAnimationFrame(() => {
                    if (!finished && document.activeElement !== el) el.focus();
                });
            } else {
                el.focus();
                if (opts?.selectAll) selectAllEditableContent(el);
                else placeCaret(el, opts?.caret ?? 'end');
            }
        },
        [navigateFrom, startRichLinePart]
    );

    /** A choice part (`data-edit-options`) is picked in the line toolbar. */
    const openLineChoice = useCallback((el: HTMLElement) => {
        const line = el.closest<HTMLElement>('[data-edit-line]');
        const resolved = line ? resolveLine(line, docRef.current, groupRef.current) : null;
        if (!resolved) return;
        setBarLine({ moduleId: resolved.module.id, index: resolved.index });
        setChoiceFocus({ name: partName(el), tick: Date.now() });
    }, []);

    const activateInteractive = useCallback(
        (el: HTMLElement, opts?: ActivateOptions) => {
            const kind = el.getAttribute('data-edit-interactive');
            if (!kind) return;
            if (kind === 'editable') {
                startEditableSlot(el, opts);
            } else if (kind === 'field') {
                startSettingsField(el, opts);
            } else if (kind === 'input') {
                startInputRegion(el);
            } else if (kind === 'part') {
                startLinePart(el, opts);
            } else if (kind === 'choice') {
                openLineChoice(el);
            }
        },
        [startEditableSlot, startSettingsField, startInputRegion, startLinePart, openLineChoice]
    );
    activateRef.current = activateInteractive;

    const findTargetInteractive = useCallback(
        (rawTarget: HTMLElement | null): HTMLElement | null => {
            if (!rawTarget) return null;
            if (
                rawTarget.closest(
                    '.eo3-inline-field-input, .eo3-inline-draft-editor, .is-inline-editing'
                )
            ) {
                return null;
            }
            if (rawTarget.closest('summary')) return null;
            const interactive = rawTarget.closest<HTMLElement>('[data-edit-interactive]');
            if (!interactive || !previewRef.current?.contains(interactive)) return null;
            return interactive;
        },
        []
    );

    const handlePreviewMouseDown = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (e.button !== 0) return;
            const rawTarget = e.target as HTMLElement | null;
            const interactive = findTargetInteractive(rawTarget);
            if (!interactive) return;
            if (activeEditRef.current?.el === interactive) return;

            const kind = interactive.getAttribute('data-edit-interactive');
            if (!kind) return;

            if (rawTarget?.closest('a[href]')) {
                e.preventDefault();
            }

            // For non-contentEditable targets (`field` / `input`), prevent default mousedown focus/blur
            // churn so the new input/textarea gets clean focus on the very first click.
            // Rich parts open an editor in place of the preview, so the click only says where.
            const richPart = kind === 'part' && isRichPart(interactive);
            const typedInPlace = kind === 'editable' || (kind === 'part' && !richPart);
            if (!typedInPlace) {
                e.preventDefault();
            }

            handledMouseDownElRef.current = interactive;
            handoffInProgressRef.current = true;
            try {
                if (activeEditRef.current) {
                    activeEditRef.current.cleanup({ handoff: true });
                }
                activateInteractive(interactive, {
                    fromMouseDown: typedInPlace,
                    point: richPart ? { x: e.clientX, y: e.clientY } : undefined,
                });
            } finally {
                handoffInProgressRef.current = false;
            }
        },
        [activateInteractive, findTargetInteractive]
    );

    const handlePreviewClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            const rawTarget = e.target as HTMLElement | null;
            if (rawTarget?.closest('a[href]') && rawTarget.closest('[data-edit-interactive]')) {
                e.preventDefault();
            }

            const interactive = findTargetInteractive(rawTarget);
            if (!interactive) {
                handledMouseDownElRef.current = null;
                return;
            }

            if (handledMouseDownElRef.current === interactive) {
                handledMouseDownElRef.current = null;
                return;
            }
            handledMouseDownElRef.current = null;

            if (activeEditRef.current?.el === interactive) return;

            handoffInProgressRef.current = true;
            try {
                if (activeEditRef.current) {
                    activeEditRef.current.cleanup({ handoff: true });
                }
                activateInteractive(interactive);
            } finally {
                handoffInProgressRef.current = false;
            }
        },
        [activateInteractive, findTargetInteractive]
    );

    const preventBlurOnBarMouseDown = useCallback((e: React.MouseEvent) => {
        if (activeEditRef.current) {
            e.preventDefault();
        }
    }, []);

    const openPopover = () => {
        if (activeEditRef.current) activeEditRef.current.cleanup();
        setPopoverOpen((v) => !v);
    };

    const handleMoveUp = () => {
        if (activeEditRef.current) activeEditRef.current.cleanup();
        onMoveUp();
    };

    const handleMoveDown = () => {
        if (activeEditRef.current) activeEditRef.current.cleanup();
        onMoveDown();
    };

    const handleRemove = () => {
        if (activeEditRef.current) activeEditRef.current.cleanup();
        onRemove();
    };

    // ── Line toolbar: choices (speaker…), add, move and remove for `[data-edit-line]`s ──

    const barLineElement = (): HTMLElement | null =>
        barLine && previewRef.current
            ? findLineElement(previewRef.current, doc, group, barLine.moduleId, barLine.index)
            : null;

    const handlePreviewMouseOver = (e: React.MouseEvent<HTMLDivElement>) => {
        if (activeEditRef.current) return; // keep the toolbar on the line being edited
        const line = (e.target as HTMLElement | null)?.closest?.('[data-edit-line-ready]');
        if (!line) return;
        const resolved = resolveLine(line, doc, group);
        if (!resolved) return;
        if (barLine?.moduleId === resolved.module.id && barLine.index === resolved.index) return;
        setBarLine({ moduleId: resolved.module.id, index: resolved.index });
    };

    const handleIslandMouseLeave = () => {
        if (activeEditRef.current) return;
        if (lineBarRef.current?.contains(window.document.activeElement)) return;
        setBarLine(null);
    };

    const chooseLineOption = (choiceName: string, value: string) => {
        if (!barLine) return;
        activeEditRef.current?.cleanup();
        const line = barLineElement();
        if (!line) return;
        const content = lineContent(line, { [choiceName]: value });
        // Show the choice at once, so a quick second edit builds on it before the render lands.
        const part = lineParts(line).find((p) => partName(p) === choiceName);
        if (part?.hasAttribute('data-edit-value')) part.setAttribute('data-edit-value', value);
        const changed = editSourceLines(doc, barLine.moduleId, (source, kind) =>
            replaceSourceLine(source, kind, barLine.index, content)
        );
        if (changed) renderNow();
    };

    const addLineBelow = () => {
        if (!barLine) return;
        activeEditRef.current?.cleanup();
        const line = barLineElement();
        if (!line) return;
        // Same choices as this line, empty text.
        const cleared: Record<string, string> = {};
        for (const part of lineParts(line)) {
            if (part.getAttribute('data-edit-interactive') === 'part') cleared[partName(part)] = '';
        }
        const content = lineContent(line, cleared);
        const firstTextPart = lineParts(line).find(
            (p) => p.getAttribute('data-edit-interactive') === 'part'
        );
        editSourceLines(doc, barLine.moduleId, (source, kind) =>
            insertSourceLine(source, kind, barLine.index, content)
        );
        pendingFocusRef.current = {
            moduleId: barLine.moduleId,
            index: barLine.index + 1,
            part: firstTextPart ? partName(firstTextPart) : 'text',
            caret: 'start',
            expect: '',
            until: Date.now() + 5000,
        };
        renderNow();
    };

    const moveLine = (delta: -1 | 1) => {
        if (!barLine) return;
        activeEditRef.current?.cleanup();
        const changed = editSourceLines(doc, barLine.moduleId, (source, kind) =>
            moveSourceLine(source, kind, barLine.index, delta)
        );
        if (!changed) return;
        setBarLine({ moduleId: barLine.moduleId, index: barLine.index + delta });
        renderNow();
    };

    const removeLine = () => {
        if (!barLine) return;
        activeEditRef.current?.cleanup();
        editSourceLines(doc, barLine.moduleId, (source, kind) =>
            removeSourceLine(source, kind, barLine.index)
        );
        setBarLine(null);
        renderNow();
    };

    const lineCount = barLine ? sourceLineCount(doc, barLine.moduleId) : 0;
    const lineBar =
        barLine && barPos ? (
            <div
                ref={lineBarRef}
                className="eo3-line-bar"
                role="toolbar"
                aria-label={`Line ${barLine.index + 1}`}
                style={{ top: barPos.top, left: barPos.left }}
                onMouseDown={(e) => {
                    // Buttons keep the caret where it is; drop-downs need focus to open.
                    if (!(e.target as HTMLElement).closest('select')) e.preventDefault();
                }}
            >
                {barChoices.map((choice) => {
                    const known = choice.options.some((o) => o.value === choice.value);
                    return (
                        <Select
                            key={choice.name}
                            narrow
                            ref={(el) => {
                                if (el) choiceSelectRefs.current.set(choice.name, el);
                                else choiceSelectRefs.current.delete(choice.name);
                            }}
                            aria-label={choice.label}
                            title={choice.label}
                            value={choice.value}
                            onChange={(e) => chooseLineOption(choice.name, e.target.value)}
                        >
                            {known ? null : (
                                <option value={choice.value}>
                                    {choice.value || '—'} (not in the list)
                                </option>
                            )}
                            {choice.options.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </Select>
                    );
                })}
                <button
                    type="button"
                    title="Add a line below"
                    aria-label="Add a line below"
                    onClick={addLineBelow}
                >
                    +
                </button>
                <button
                    type="button"
                    title="Move line up"
                    aria-label="Move line up"
                    disabled={barLine.index <= 0}
                    onClick={() => moveLine(-1)}
                >
                    ↑
                </button>
                <button
                    type="button"
                    title="Move line down"
                    aria-label="Move line down"
                    disabled={barLine.index >= lineCount - 1}
                    onClick={() => moveLine(1)}
                >
                    ↓
                </button>
                <button
                    type="button"
                    title="Remove line"
                    aria-label="Remove line"
                    onClick={removeLine}
                >
                    ×
                </button>
            </div>
        ) : null;

    return (
        <div
            ref={islandRef}
            className={'eo3-inline-island' + (popoverOpen || inlineEditing ? ' is-editing' : '')}
            onMouseLeave={handleIslandMouseLeave}
        >
            <div
                className="eo3-island-bar"
                aria-label={`${name} block controls`}
                onMouseDown={preventBlurOnBarMouseDown}
            >
                <span className="eo3-island-label">{name}</span>
                <button
                    ref={editBtnRef}
                    type="button"
                    className={'eo3-island-edit' + (popoverOpen ? ' is-active' : '')}
                    aria-expanded={popoverOpen}
                    onClick={openPopover}
                >
                    <EditIcon />
                    <span>Edit</span>
                </button>
                {showReorder ? (
                    <>
                        <button
                            type="button"
                            title="Move up"
                            aria-label={`Move ${name} up`}
                            disabled={!canMoveUp}
                            onClick={handleMoveUp}
                        >
                            ↑
                        </button>
                        <button
                            type="button"
                            title="Move down"
                            aria-label={`Move ${name} down`}
                            disabled={!canMoveDown}
                            onClick={handleMoveDown}
                        >
                            ↓
                        </button>
                    </>
                ) : null}
                <button
                    type="button"
                    title="Remove"
                    aria-label={`Remove ${name}`}
                    onClick={handleRemove}
                >
                    ×
                </button>
            </div>
            {previewHtml ? (
                <div
                    ref={previewRef}
                    className="eo3-island-preview"
                    onMouseDown={handlePreviewMouseDown}
                    onMouseOver={handlePreviewMouseOver}
                    onClick={handlePreviewClick}
                    onDoubleClick={(e) => {
                        const target = e.target as HTMLElement | null;
                        if (
                            target?.closest(
                                '[data-edit-interactive], .eo3-inline-field-input, .eo3-inline-draft-editor, .is-inline-editing'
                            )
                        ) {
                            return;
                        }
                        openPopover();
                    }}
                />
            ) : (
                <div className="eo3-island-empty" onClick={() => setPopoverOpen(true)}>
                    <span>{name}</span> — click Edit to fill in
                </div>
            )}
            {lineBar}
            {activeRich
                ? createPortal(
                      <RichEditor
                          ref={richEditorRef}
                          variant="inline"
                          className="eo3-rich-part-editor"
                          value={activeRich.html}
                          onChange={activeRich.onChange}
                          onKeyDown={activeRich.onKeyDown}
                          autoFocus={activeRich.autoFocus}
                      />,
                      activeRich.host
                  )
                : null}
            {activeInput
                ? createPortal(
                      <InlineDraftEditor
                          document={doc}
                          moduleId={activeInput.moduleId}
                          label={activeInput.label}
                          initialValue={activeInput.initialValue}
                          help={activeInput.help}
                          islandRoot={islandRef.current}
                          flushRef={draftFlushRef}
                          onClose={closeInputPortal}
                      />,
                      activeInput.container
                  )
                : null}
            <DirPopover
                portal
                anchor={editBtnRef.current}
                anchorBias="left"
                open={popoverOpen}
                onClose={() => setPopoverOpen(false)}
            >
                {popoverOpen ? (
                    <div className="eo3-island-popover">
                        <header className="eo3-popover-head">
                            <h4>{name}</h4>
                            <button
                                type="button"
                                className="eo3-popover-close"
                                aria-label={`Close ${name} editor`}
                                onClick={() => setPopoverOpen(false)}
                            >
                                ×
                            </button>
                        </header>
                        <div className="eo3-popover-scroll">
                            {renderEditor ? renderEditor() : editor}
                        </div>
                    </div>
                ) : null}
            </DirPopover>
        </div>
    );
});

/**
 * In-place text editor mounted directly inside a `[data-edit-input]` region of a styled template
 * (keeping the surrounding card/letter/chat/terminal frame visible).
 */
function InlineDraftEditor({
    document: doc,
    moduleId,
    label,
    initialValue,
    help,
    islandRoot,
    flushRef,
    onClose,
}: {
    document: Document;
    moduleId: string;
    label: string;
    initialValue: string;
    help?: TextHelpMetadata;
    islandRoot: HTMLElement | null;
    flushRef: React.MutableRefObject<(() => boolean) | null>;
    onClose: () => void;
}) {
    const [value, setValue] = useState(initialValue);
    const valueRef = useRef(value);
    valueRef.current = value;
    const docRef = useRef(doc);
    docRef.current = doc;
    const wrapRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const revertedRef = useRef(false);
    const closedRef = useRef(false);

    const flush = useCallback((): boolean => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (revertedRef.current) return false;
        updateTextModuleContents(docRef.current, moduleId, valueRef.current);
        return valueRef.current !== initialValue;
    }, [initialValue, moduleId]);

    flushRef.current = flush;

    const commitAndClose = useCallback(() => {
        if (closedRef.current) return;
        closedRef.current = true;
        onClose();
    }, [onClose]);

    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        sizeTextarea(ta);
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
    }, []);

    useEffect(() => {
        const onDocMouseDown = (e: MouseEvent) => {
            if (!wrapRef.current) return;
            const target = e.target as HTMLElement | null;
            if (!target || wrapRef.current.contains(target)) return;
            // Let same-island interactive fields or control bar perform a clean single-click handoff
            // instead of collapsing the textarea mid-click and shifting the target away.
            if (
                islandRoot &&
                islandRoot.contains(target) &&
                target.closest('[data-edit-interactive], .eo3-island-bar')
            ) {
                return;
            }
            commitAndClose();
        };
        document.addEventListener('mousedown', onDocMouseDown, true);
        return () => {
            document.removeEventListener('mousedown', onDocMouseDown, true);
            flush();
        };
    }, [commitAndClose, flush, islandRoot]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const next = e.target.value;
        setValue(next);
        valueRef.current = next;
        sizeTextarea(e.target);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            updateTextModuleContents(docRef.current, moduleId, next);
        }, INLINE_DEBOUNCE_MS);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            revertedRef.current = true;
            closedRef.current = true;
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            updateTextModuleContents(docRef.current, moduleId, initialValue);
            onClose();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            commitAndClose();
        }
    };

    const hints = help?.examples?.slice(0, 3) ?? [];

    return (
        <div
            ref={wrapRef}
            className="eo3-inline-draft-editor"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            <textarea
                ref={textareaRef}
                className="eo3-inline-draft-textarea"
                aria-label={`Edit ${label}`}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                rows={4}
            />
            <div className="eo3-inline-draft-bar">
                <div className="eo3-inline-draft-hints">
                    {hints.length > 0 ? (
                        hints.map((ex, i) => (
                            <span key={i} className="eo3-inline-draft-hint" title={ex.description}>
                                <code>{ex.syntax}</code>
                            </span>
                        ))
                    ) : help?.summary ? (
                        <span className="eo3-inline-draft-summary">{help.summary}</span>
                    ) : (
                        <span className="eo3-inline-draft-summary">
                            Ctrl+Enter to finish · Esc to cancel
                        </span>
                    )}
                </div>
                <button type="button" className="eo3-inline-draft-done" onClick={commitAndClose}>
                    Done
                </button>
            </div>
        </div>
    );
}
