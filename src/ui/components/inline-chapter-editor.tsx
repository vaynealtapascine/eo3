import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import parse from 'html-react-parser';
import {
    AnyModule,
    Document,
    JsonValue,
    Module,
    ModuleGroup,
    ModuleId,
    ModulePlugin,
    RenderOutput,
    moduleDescription,
} from '../../document';
import { collectPartLiveCss } from '../../editor/work-styles';
import { blockSinks, isTransformModule, itemKey, LinearItem, LinearOrderError } from '../../linear';
import { MODULES } from '../../plugins';
import { cleanWorkskinCss, renderAo3Content } from '../../targets/ao3/render';
import { scopeCss } from '../../targets/delivery/scope-css';
import { partScopeClass } from '../../targets/delivery/shared-stylesheet';
import { DirPopover } from '../../uikit/dir-popover';
import { showAlert, showConfirm } from '../dialogs';
import { EditorCanvasContext } from '../editor-canvas-context';
import { setEditorView } from '../editor-view';
import { RichEditor } from './rich-editor';
import { InlinePreviewIsland } from './inline-preview-island';
import { AddMenu, Added, BlockBody, itemName, ModuleEditor, pinnedModules } from './simple-editor';
import {
    CodeBracesIcon,
    FormatTextIcon,
    PlusIcon,
    SidebarActiveIcon,
    SidebarIcon,
    SparklesIcon,
} from './icons';
import './inline-chapter-editor.css';

export interface InlineChapterEditorProps {
    document: Document;
    partId: string | null;
    renderOutput: RenderOutput | null;
    /** Exported AO3 HTML used as fallback when a chapter has effects or non-linear wiring. */
    fallbackHtml: string;
    panelOpen: boolean;
    onTogglePanel: () => void;
    onOpenModule?: (moduleId: ModuleId) => void;
}

const CSS_PLUGIN_IDS = new Set([
    'source.shared-styles',
    'source.lesscss',
    'source.sass',
    'source.sass-module',
]);

function isCssModule(mod: AnyModule | undefined): boolean {
    if (!mod) return false;
    if (CSS_PLUGIN_IDS.has(mod.plugin.id)) return true;
    if (mod.plugin.id === 'source.text') {
        return (mod.data as { language?: string } | null)?.language === 'css';
    }
    return false;
}

function isRichTextModule(mod: AnyModule | undefined): boolean {
    return (
        !!mod &&
        mod.plugin.id === 'source.text' &&
        (mod.data as { language?: string } | null)?.language === 'html-contenteditable'
    );
}

/** Keeps focus inside the active inline editor when clicking side-rail popover buttons. */
function preventFocusSteal(e: React.MouseEvent) {
    e.preventDefault();
}

/**
 * Direct-in-preview chapter editor mounted inside AO3's `#workskin .userstuff`.
 *
 * Rich-text (`html-contenteditable`) modules render as chrome-less inline TipTap surfaces that
 * inherit AO3 typography and Work Skin CSS directly. Ready-made blocks and custom modules render
 * as live AO3 preview islands with hover/focus popovers for editing their inputs. A compact
 * floating side rail provides Styles, Format, Insert (+), Work Skin CSS ({ }), and Panel (☰).
 */
export function InlineChapterEditor({
    document,
    partId,
    renderOutput,
    fallbackHtml,
    panelOpen,
    onTogglePanel,
}: InlineChapterEditorProps) {
    const part = document.findPart(partId ?? '') ?? document.parts[0];
    const linear = document.linear;

    const editorRefs = useRef(new Map<string, RichEditor>());
    const [activeEditorId, setActiveEditorId] = useState<string | null>(null);
    const [stylesOpen, setStylesOpen] = useState(false);
    const stylesBtnRef = useRef<HTMLButtonElement>(null);

    // Preload `source.text` so typing in an empty chapter creates its module synchronously
    // without remounting the active TipTap instance or dropping keystrokes.
    const sourceTextPluginRef = useRef<ModulePlugin<JsonValue> | null>(null);
    useEffect(() => {
        let alive = true;
        MODULES['source.text'].load().then((plugin) => {
            if (alive) sourceTextPluginRef.current = plugin;
        });
        return () => {
            alive = false;
        };
    }, []);

    // Stable React key bridge so an empty-chapter draft seamlessly becomes the created module.
    const draftKeyByPartRef = useRef(new Map<string, string>());
    const moduleKeyAliasRef = useRef(new Map<ModuleId, string>());
    const pendingDraftRef = useRef<{ partId: string; contents: string; draftKey: string } | null>(
        null
    );
    const creatingDraftRef = useRef(false);

    const getDraftKey = (id: string) => {
        let key = draftKeyByPartRef.current.get(id);
        if (!key) {
            key = `inline-draft-${id}`;
            draftKeyByPartRef.current.set(id, key);
        }
        return key;
    };

    const setEditorRef = useCallback(
        (id: string) => (instance: RichEditor | null) => {
            if (instance) editorRefs.current.set(id, instance);
            else editorRefs.current.delete(id);
        },
        []
    );

    const getActiveEditor = (): RichEditor | null => {
        if (activeEditorId) {
            const found = editorRefs.current.get(activeEditorId);
            if (found) return found;
        }
        const first = editorRefs.current.values().next();
        return first.done ? null : first.value;
    };

    const scopedClass = part ? partScopeClass(part.id) : '';
    const { canvasCss } = useContext(EditorCanvasContext);
    const rawLiveCss =
        canvasCss || collectPartLiveCss(document, part?.id ?? null, renderOutput?.work);
    const inlineLiveCss = useMemo(() => {
        if (!rawLiveCss.trim()) return '';
        const cleaned = cleanWorkskinCss(rawLiveCss, { prefix: '#workskin' });
        if (!cleaned.trim()) return '';
        return scopedClass ? scopeCss(cleaned, `.${scopedClass}`, '#workskin') : cleaned;
    }, [rawLiveCss, scopedClass]);
    const liveStyleTag = inlineLiveCss ? (
        <style data-eo3-inline-live-css="">{inlineLiveCss}</style>
    ) : null;

    // Non-linear graph: fall back to rendered HTML with quick buttons to open panel or Nodes view.
    if (!part || !('layout' in linear)) {
        return (
            <div className={'eo3-inline-chapter is-fallback ' + scopedClass}>
                {liveStyleTag}
                <div className="eo3-inline-banner" role="note">
                    <span>
                        This work has custom node wiring — edit in the side panel or Nodes view.
                    </span>
                    <div className="eo3-inline-banner-actions">
                        {!panelOpen ? (
                            <button type="button" onClick={onTogglePanel}>
                                Open panel
                            </button>
                        ) : null}
                        <button type="button" onClick={() => setEditorView('nodes')}>
                            Nodes view
                        </button>
                    </div>
                </div>
                <Ao3FallbackHtml source={fallbackHtml} />
            </div>
        );
    }

    const layout = linear.layout;
    const items = layout.parts[part.id] ?? [];

    const applyLayout = (lists: Record<string, LinearItem[]>, added?: Added) => {
        try {
            document.applyLinearLayout({ parts: { ...layout.parts, ...lists } }, added);
        } catch (error) {
            if (!(error instanceof LinearOrderError)) throw error;
            showAlert(error.message, { title: 'Can’t put it there' });
        }
    };
    const setItems = (next: LinearItem[], added?: Added) => applyLayout({ [part.id]: next }, added);

    const hasEffect = items.some(
        (item) => item.kind === 'module' && isTransformModule(document.findModule(item.moduleId)!)
    );

    // Chapter-specific CSS modules listed in this part + managed pinned styles ("All chapters", etc.)
    const pinnedCss = pinnedModules(document, part.outputId, part.stylesModuleId);
    const chapterCssModules = items
        .map((item) => (item.kind === 'module' ? document.findModule(item.moduleId) : undefined))
        .filter((mod): mod is AnyModule => isCssModule(mod));
    const seenStyleIds = new Set<ModuleId>();
    const allStyleModules: AnyModule[] = [];
    for (const mod of [...pinnedCss, ...chapterCssModules]) {
        if (!seenStyleIds.has(mod.id)) {
            seenStyleIds.add(mod.id);
            allStyleModules.push(mod);
        }
    }

    // Mirror choices from other chapters (matches SimpleEditor's AddMenu)
    const listedHere = new Set(items.map(itemKey));
    const elsewhere = new Map<string, { item: LinearItem; parts: number[] }>();
    document.parts.forEach((p, j) => {
        if (p.id === part.id) return;
        for (const item of layout.parts[p.id] ?? []) {
            const key = itemKey(item);
            const mod = item.kind === 'module' ? document.findModule(item.moduleId) : undefined;
            if (listedHere.has(key) || (mod && isTransformModule(mod))) continue;
            if (!elsewhere.has(key)) elsewhere.set(key, { item, parts: [] });
            elsewhere.get(key)!.parts.push(j);
        }
    });
    const mirrorChoices = [...elsewhere.values()].map(({ item, parts }) => ({
        title: itemName(document, item),
        description: `In Chapter${parts.length > 1 ? 's' : ''} ${parts
            .map((j) => j + 1)
            .join(', ')}`,
        add: () => setItems([...items, item]),
    }));

    const addItem = (item: LinearItem, added?: Added) => {
        setItems([...items, item], added);
        if (item.kind === 'module') {
            const addedMod =
                added?.modules?.find((m) => m.id === item.moduleId) ??
                document.findModule(item.moduleId);
            if (isCssModule(addedMod)) {
                setStylesOpen(true);
            } else {
                setActiveEditorId(item.moduleId);
            }
        }
    };

    const moveItem = (indexInItems: number, delta: -1 | 1) => {
        // Find the next visible (non-CSS) item in that direction so ↑/↓ always visibly moves it.
        let target = indexInItems + delta;
        while (target >= 0 && target < items.length) {
            const candidate = items[target];
            const mod =
                candidate.kind === 'module' ? document.findModule(candidate.moduleId) : undefined;
            if (!isCssModule(mod)) break;
            target += delta;
        }
        if (target < 0 || target >= items.length) return;
        const next = items.slice();
        const [moved] = next.splice(indexInItems, 1);
        next.splice(target, 0, moved);
        setItems(next);
    };

    const removeItem = async (indexInItems: number, name: string) => {
        const yes = await showConfirm(`Remove “${name}” from this chapter?`, {
            confirmLabel: 'Remove',
            danger: true,
        });
        if (yes) setItems(items.filter((_, i) => i !== indexInItems));
    };

    // Visible (non-CSS) items in chapter order, keeping their index in `items`.
    const visibleEntries = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
            if (item.kind === 'block') return true;
            return !isCssModule(document.findModule(item.moduleId));
        });

    const isEmptyChapter = !hasEffect && visibleEntries.length === 0;
    const hasRichEditor =
        isEmptyChapter ||
        (!hasEffect &&
            visibleEntries.some(
                ({ item }) =>
                    item.kind === 'module' && isRichTextModule(document.findModule(item.moduleId))
            ));

    const commitDraftModule = (contents: string) => {
        if (!contents.trim()) return;
        const draftKey = getDraftKey(part.id);
        const plugin = sourceTextPluginRef.current;
        if (plugin) {
            const mod = new Module(plugin, { contents, language: 'html-contenteditable' });
            moduleKeyAliasRef.current.set(mod.id, draftKey);
            setActiveEditorId(mod.id);
            setItems([...items, { kind: 'module', moduleId: mod.id }], { modules: [mod] });
            return;
        }
        // Fallback if the user typed before `MODULES['source.text'].load()` finished.
        pendingDraftRef.current = { partId: part.id, contents, draftKey };
        if (creatingDraftRef.current) return;
        creatingDraftRef.current = true;
        MODULES['source.text'].load().then((loaded) => {
            sourceTextPluginRef.current = loaded;
            creatingDraftRef.current = false;
            const pending = pendingDraftRef.current;
            pendingDraftRef.current = null;
            if (!pending || pending.partId !== part.id) return;
            const latestLinear = document.linear;
            if (!('layout' in latestLinear)) return;
            const latestItems = latestLinear.layout.parts[part.id] ?? [];
            const mod = new Module(loaded, {
                contents: pending.contents,
                language: 'html-contenteditable',
            });
            moduleKeyAliasRef.current.set(mod.id, pending.draftKey);
            setActiveEditorId(mod.id);
            document.applyLinearLayout(
                {
                    parts: {
                        ...latestLinear.layout.parts,
                        [part.id]: [...latestItems, { kind: 'module', moduleId: mod.id }],
                    },
                },
                { modules: [mod] }
            );
        });
    };

    const addWorkStyles = async () => {
        if (document.state.sharedStylesModuleId === undefined) {
            await document.ensureSharedStyles();
            return;
        }
        await document.partStyles(part.id, 'Chapter styles');
    };

    const sideRail = (
        <aside className="eo3-side-rail" aria-label="Chapter editing tools">
            <button
                type="button"
                className="eo3-rail-btn"
                title={
                    hasRichEditor
                        ? 'CSS Pieces & Styles'
                        : 'Add a text section to apply CSS pieces & styles'
                }
                aria-label="Styles and CSS pieces"
                disabled={!hasRichEditor}
                onMouseDown={preventFocusSteal}
                onClick={(e) => getActiveEditor()?.openStyles(e.currentTarget)}
            >
                <SparklesIcon />
            </button>
            <button
                type="button"
                className="eo3-rail-btn"
                title={
                    hasRichEditor
                        ? 'Text formatting, links, ruby & chapter break'
                        : 'Add a text section to format text'
                }
                aria-label="Text formatting toolbar"
                disabled={!hasRichEditor}
                onMouseDown={preventFocusSteal}
                onClick={(e) => getActiveEditor()?.openFormat(e.currentTarget)}
            >
                <FormatTextIcon />
            </button>
            <AddMenu
                onAdd={addItem}
                mirrorChoices={mirrorChoices}
                buttonClassName="eo3-rail-btn"
                buttonLabel={<PlusIcon />}
                buttonTitle="Insert text, block, or module"
                ariaLabel="Insert text, block, or module"
                anchorBias="right"
                compact
            />
            <button
                ref={stylesBtnRef}
                type="button"
                className={'eo3-rail-btn' + (stylesOpen ? ' is-active' : '')}
                title="Edit Work Skin CSS"
                aria-label="Edit Work Skin CSS"
                aria-expanded={stylesOpen}
                onClick={() => setStylesOpen((v) => !v)}
            >
                <CodeBracesIcon />
            </button>
            <span className="eo3-rail-sep" aria-hidden="true" />
            <button
                type="button"
                className={'eo3-rail-btn' + (panelOpen ? ' is-active' : '')}
                title={panelOpen ? 'Hide side panel' : 'Open side panel (chapters, HTML & modules)'}
                aria-label={panelOpen ? 'Hide side panel' : 'Open side panel'}
                aria-pressed={panelOpen}
                onClick={onTogglePanel}
            >
                {panelOpen ? <SidebarActiveIcon /> : <SidebarIcon />}
            </button>

            <DirPopover
                portal
                anchor={stylesBtnRef.current}
                anchorBias="left"
                open={stylesOpen}
                onClose={() => setStylesOpen(false)}
            >
                {stylesOpen ? (
                    <div className="eo3-styles-quick-popover">
                        <header className="eo3-popover-head">
                            <h4>Work Skin CSS</h4>
                            <button
                                type="button"
                                className="eo3-popover-close"
                                aria-label="Close CSS editor"
                                onClick={() => setStylesOpen(false)}
                            >
                                ×
                            </button>
                        </header>
                        <div className="eo3-popover-scroll">
                            {allStyleModules.length ? (
                                allStyleModules.map((mod) => (
                                    <div className="eo3-css-card" key={mod.id}>
                                        <div className="eo3-css-card-title">
                                            {mod.title ||
                                                moduleDescription(document, mod, 'Chapter')}
                                        </div>
                                        <ModuleEditor
                                            document={document}
                                            module={mod}
                                            userData={renderOutput?.userData.get(mod.id)}
                                        />
                                    </div>
                                ))
                            ) : (
                                <div className="eo3-css-empty">
                                    <p>No Work Skin CSS yet.</p>
                                    <button type="button" onClick={addWorkStyles}>
                                        + Add Work Skin stylesheet
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ) : null}
            </DirPopover>
        </aside>
    );

    // Chapter with a transform/effect module: show full rendered HTML + side rail + panel prompt.
    if (hasEffect) {
        return (
            <div className={'eo3-inline-chapter is-effect-chapter ' + scopedClass}>
                {liveStyleTag}
                <div className="eo3-inline-body">
                    <div className="eo3-inline-banner" role="note">
                        <span>
                            This chapter includes an effect — open the panel to edit its items.
                        </span>
                        {!panelOpen ? (
                            <button type="button" onClick={onTogglePanel}>
                                Open panel
                            </button>
                        ) : null}
                    </div>
                    <Ao3FallbackHtml source={fallbackHtml} />
                </div>
                {sideRail}
            </div>
        );
    }

    return (
        <div
            className={
                'eo3-inline-chapter ' +
                scopedClass +
                (isEmptyChapter ? ' is-empty' : '') +
                (visibleEntries.length === 1 ? ' is-single' : '')
            }
        >
            {liveStyleTag}
            <div className="eo3-inline-body">
                {isEmptyChapter ? (
                    <div className="eo3-inline-segment is-rich is-draft">
                        <RichEditor
                            key={getDraftKey(part.id)}
                            ref={setEditorRef(getDraftKey(part.id))}
                            variant="inline"
                            value=""
                            onChange={commitDraftModule}
                            onFocus={() => setActiveEditorId(getDraftKey(part.id))}
                            placeholder="Start writing your chapter… (highlight text for styles & formatting)"
                        />
                    </div>
                ) : (
                    visibleEntries.map(({ item, index }, visibleIndex) => {
                        const canMoveUp = visibleIndex > 0;
                        const canMoveDown = visibleIndex < visibleEntries.length - 1;
                        const name = itemName(document, item);

                        if (item.kind === 'module') {
                            const mod = document.findModule(item.moduleId);
                            if (!mod) return null;

                            if (isRichTextModule(mod)) {
                                const stableKey = moduleKeyAliasRef.current.get(mod.id) ?? mod.id;
                                const data = mod.data as { contents?: string };
                                return (
                                    <div
                                        key={stableKey}
                                        className="eo3-inline-segment is-rich"
                                        data-module-id={mod.id}
                                    >
                                        {visibleEntries.length > 1 ? (
                                            <div
                                                className="eo3-segment-controls"
                                                aria-label={`${name} controls`}
                                            >
                                                <span className="eo3-seg-label">{name}</span>
                                                <button
                                                    type="button"
                                                    title="Move up"
                                                    aria-label={`Move ${name} up`}
                                                    disabled={!canMoveUp}
                                                    onClick={() => moveItem(index, -1)}
                                                >
                                                    ↑
                                                </button>
                                                <button
                                                    type="button"
                                                    title="Move down"
                                                    aria-label={`Move ${name} down`}
                                                    disabled={!canMoveDown}
                                                    onClick={() => moveItem(index, 1)}
                                                >
                                                    ↓
                                                </button>
                                                <button
                                                    type="button"
                                                    title="Remove"
                                                    aria-label={`Remove ${name}`}
                                                    onClick={() => removeItem(index, name)}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ) : null}
                                        <RichEditor
                                            ref={setEditorRef(mod.id)}
                                            variant="inline"
                                            value={data.contents ?? ''}
                                            onChange={(contents) => {
                                                const next = mod.shallowClone();
                                                next.data = {
                                                    ...(mod.data as Record<string, JsonValue>),
                                                    contents,
                                                };
                                                document.insertModule(next);
                                            }}
                                            onFocus={() => setActiveEditorId(mod.id)}
                                            placeholder={
                                                visibleEntries.length === 1
                                                    ? 'Start writing your chapter… (highlight text for styles & formatting)'
                                                    : 'Write here…'
                                            }
                                        />
                                    </div>
                                );
                            }

                            const isRawHtmlText =
                                mod.plugin.id === 'source.text' &&
                                (mod.data as { language?: string } | null)?.language === 'html';
                            const rawHtml = isRawHtmlText
                                ? String((mod.data as { contents?: unknown })?.contents ?? '')
                                : renderOutput?.outputs.get(mod.id)?.asMdOutput() ??
                                  (mod.plugin.id === 'source.text'
                                      ? String((mod.data as { contents?: unknown })?.contents ?? '')
                                      : '');
                            return (
                                <InlinePreviewIsland
                                    key={mod.id}
                                    document={document}
                                    module={mod}
                                    name={name}
                                    rawHtml={rawHtml}
                                    canMoveUp={canMoveUp}
                                    canMoveDown={canMoveDown}
                                    showReorder={visibleEntries.length > 1}
                                    onMoveUp={() => moveItem(index, -1)}
                                    onMoveDown={() => moveItem(index, 1)}
                                    onRemove={() => removeItem(index, name)}
                                    renderEditor={() => (
                                        <ModuleEditor
                                            document={document}
                                            module={mod}
                                            userData={renderOutput?.userData.get(mod.id)}
                                        />
                                    )}
                                />
                            );
                        }

                        const group = document.findGroup(item.groupId);
                        if (!group) return null;
                        const rawHtml = blockSinks(group, document.modules)
                            .map((sink) => {
                                if (
                                    sink.plugin.id === 'source.text' &&
                                    (sink.data as { language?: string } | null)?.language === 'html'
                                ) {
                                    return String(
                                        (sink.data as { contents?: unknown })?.contents ?? ''
                                    );
                                }
                                const evaluated = renderOutput?.outputs.get(sink.id)?.asMdOutput();
                                if (evaluated !== undefined) return evaluated ?? '';
                                if (sink.plugin.id === 'source.text' && !isCssModule(sink)) {
                                    return String(
                                        (sink.data as { contents?: unknown })?.contents ?? ''
                                    );
                                }
                                return '';
                            })
                            .filter(Boolean)
                            .join('\n');

                        return (
                            <InlinePreviewIsland
                                key={group.id}
                                document={document}
                                group={group as ModuleGroup}
                                name={name}
                                rawHtml={rawHtml}
                                canMoveUp={canMoveUp}
                                canMoveDown={canMoveDown}
                                showReorder={visibleEntries.length > 1}
                                onMoveUp={() => moveItem(index, -1)}
                                onMoveDown={() => moveItem(index, 1)}
                                onRemove={() => removeItem(index, name)}
                                renderEditor={() => (
                                    <BlockBody
                                        document={document}
                                        group={group as ModuleGroup}
                                        userData={renderOutput?.userData}
                                    />
                                )}
                            />
                        );
                    })
                )}
            </div>
            {sideRail}
        </div>
    );
}

function Ao3FallbackHtml({ source }: { source: string }) {
    const html = useMemo(() => (source.trim() ? renderAo3Content(source).html : ''), [source]);
    return <div className="eo3-inline-fallback-html">{parse(html)}</div>;
}
