import {
    createRef,
    useState,
    useEffect,
    useId,
    PureComponent,
    useRef,
    useInsertionEffect,
} from 'react';
import { Document, RenderState, RenderTarget } from '../../document';
import { CodeEditor } from './code-editor';
import { javascript } from '@codemirror/lang-javascript';
import { PostPreview, PreviewConfig, makeDefaultPreviewConfig } from './post-preview';
import { DataPreview } from './data-preview';
import { SITE_TARGETS } from '../../targets';
import { copiedKey, useSiteTarget } from '../../targets/context';
import { removeLiftedSkinRules } from '../../targets/delivery/skin-record';
import { splitHtml, splitHtmlAtMarker, SPLIT_MARKER } from '../../util/split-html';
import {
    listProfiles,
    PROFILE_TARGET_PREFIX,
    subscribeProfiles,
} from '../../targets/profile/store';
import { ProfileEditor } from './profile-editor';

/** Site-selector entry that opens the custom site editor instead of switching targets. */
const EDIT_PROFILES = '__edit-profiles';
import './preview.scss';

export function Preview({
    document,
    render,
    partId,
    onPartChange,
    copiedParts,
    onPartCopied,
    clickToRender,
    onTargetChange,
    onLiveChange,
    onRender,
}: Preview.Props) {
    let contents = null;
    const shownPart = document.findPart(partId ?? '') ?? document.parts[0];
    const { id: siteTargetId, plugin: siteTargetPlugin, setId: setSiteTargetId } = useSiteTarget();
    const [previewConfig, onPreviewConfigChange] = useState<PreviewConfig | null>(null);
    const [readMore, setReadMore] = useState(false);
    const [editingProfiles, setEditingProfiles] = useState(false);
    const [profiles, setProfiles] = useState(listProfiles);
    useEffect(() => subscribeProfiles(() => setProfiles(listProfiles())), []);
    const lastPostPreviewHeight = useRef(0);
    const previewContainer = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (siteTargetPlugin && (!previewConfig || previewConfig.target !== siteTargetPlugin.id)) {
            onPreviewConfigChange(makeDefaultPreviewConfig(siteTargetPlugin));
        }
    }, [siteTargetPlugin]);

    useInsertionEffect(() => {
        const preview = previewContainer.current;
        if (!preview) return;
        lastPostPreviewHeight.current = preview.offsetHeight;
    });

    const postErrorPortal = useRef<HTMLDivElement>(null);
    let errorContents = null;

    if (clickToRender) {
        contents = (
            <div className="i-preview-click-to-render">
                <p className="i-description">rendering paused</p>
                <button onClick={clickToRender}>render</button>
            </div>
        );
    } else if (render.output) {
        const work = render.output.work;
        if (render.output.target) {
            const data = render.output.outputs.get(render.output.target)!;

            contents = (
                <div className="i-data-preview" ref={previewContainer}>
                    <DataPreview data={data} />
                </div>
            );
        } else if (
            work &&
            siteTargetPlugin &&
            previewConfig &&
            previewConfig.target === siteTargetPlugin.id
        ) {
            contents = (
                <div className="i-post-preview" ref={previewContainer}>
                    <PostPreview
                        renderId={render.id}
                        workTitle={document.title}
                        author={document.author}
                        stale={render.rendering}
                        work={work}
                        partId={shownPart.id}
                        posted={shownPart.postedTo[siteTargetId] ?? null}
                        copied={copiedParts.includes(copiedKey(siteTargetId, shownPart.id))}
                        onPartCopied={(id) => onPartCopied(copiedKey(siteTargetId, id))}
                        onPostedChange={(id, posted, rules) =>
                            document.setPartPosted(siteTargetId, id, posted, rules)
                        }
                        onCleanupUnusedStyles={() => document.cleanupUnusedSkinRules(siteTargetId)}
                        onSplitPart={(id, fits) => splitPart(document, id, fits)}
                        onPruneProtectedStyles={(names) => {
                            const module = document.findModule(document.importedSkinModuleId ?? '');
                            const css =
                                (module?.data as { contents?: string } | undefined)?.contents ?? '';
                            document.pruneImportedSkinRules(
                                siteTargetId,
                                names,
                                removeLiftedSkinRules(css, names)
                            );
                        }}
                        plugin={siteTargetPlugin}
                        config={previewConfig}
                        onConfigChange={onPreviewConfigChange}
                        readMore={readMore}
                        onReadMoreChange={setReadMore}
                        errorPortal={postErrorPortal.current}
                    />
                </div>
            );
        }
    } else if (render.error) {
        let moduleIndex = null;
        let moduleLabel = null;
        if (render.error.source) {
            const module = document.findModule(render.error.source);
            if (module) {
                moduleIndex = document.modules.indexOf(module);
                moduleLabel = module.plugin.description(module.data);
            }
        }

        let errorString = (render.error.error as any).toString();
        let sourceJavascript = (render.error.error as any).sourceJavascript;
        let sourceJavascriptLine = (render.error.error as any).sourceJavascriptLine;

        contents = (
            <div
                className="preview-error-placeholder"
                style={{
                    minHeight: lastPostPreviewHeight.current,
                }}
            ></div>
        );

        errorContents = (
            <div className="preview-error">
                {moduleIndex !== null ? (
                    <div className="error-title">
                        Error in {moduleIndex + 1}. {moduleLabel}
                    </div>
                ) : (
                    <div className="error-title">Error</div>
                )}
                <div className="error-contents">{errorString}</div>
                {sourceJavascript ? (
                    <div className="error-source">
                        <div className="inner-title">Source Script</div>
                        <SourceJavascript source={sourceJavascript} line={sourceJavascriptLine} />
                    </div>
                ) : null}
            </div>
        );
    }

    const modules = document.modules;
    const outputTargets = [];
    for (let i = 0; i < modules.length; i++) {
        const module = modules[i];
        outputTargets.push(
            <option value={module.id} key={module.id}>
                {i + 1}. {module.title || module.plugin.description(module.data)}
            </option>
        );
    }

    const liveCheckbox = useId();

    return (
        <div className="data-preview" aria-label="Preview">
            <ProfileEditor
                open={editingProfiles}
                document={document}
                onClose={() => setEditingProfiles(false)}
                onUse={(id) => {
                    setSiteTargetId(PROFILE_TARGET_PREFIX + id);
                    setEditingProfiles(false);
                }}
            />
            <div className="preview-header">
                <div className="preview-config">
                    <select
                        className="output-select"
                        value={render.target || 'output'}
                        onChange={(e) => {
                            const target = (e.target as HTMLSelectElement).value;
                            if (target === 'output') onTargetChange(null);
                            else onTargetChange(target);
                        }}
                    >
                        {outputTargets}
                        <option value="output">output</option>
                    </select>
                    {!render.target && document.parts.length > 1 && (
                        <select
                            className="part-select"
                            aria-label="Part to preview"
                            value={partId ?? document.parts[0].id}
                            onChange={(e) => onPartChange((e.target as HTMLSelectElement).value)}
                        >
                            {document.parts.map((part, i) => (
                                <option value={part.id} key={part.id}>
                                    {siteTargetPlugin?.partLabel ?? 'Part'} {i + 1}
                                    {part.title ? `: ${part.title}` : ''}
                                </option>
                            ))}
                        </select>
                    )}
                    {!render.target && (
                        <select
                            className="site-target-select"
                            value={siteTargetId}
                            onChange={(e) => {
                                const value = (e.target as HTMLSelectElement).value;
                                if (value === EDIT_PROFILES) setEditingProfiles(true);
                                else setSiteTargetId(value);
                            }}
                        >
                            {Object.entries(SITE_TARGETS).map(([id, def]) => (
                                <option value={id} key={id}>
                                    {def.title}
                                </option>
                            ))}
                            {profiles.map((profile) => (
                                <option value={PROFILE_TARGET_PREFIX + profile.id} key={profile.id}>
                                    {profile.title}
                                </option>
                            ))}
                            <option value={EDIT_PROFILES}>custom sites…</option>
                        </select>
                    )}
                    <span className="live-update">
                        <input
                            id={liveCheckbox}
                            checked={render.live}
                            onChange={(e) => {
                                onLiveChange((e.target as HTMLInputElement).checked);
                            }}
                            type="checkbox"
                        />{' '}
                        <label htmlFor={liveCheckbox}>Live Update</label>
                    </span>
                    {!render.live && (
                        <button className="render-button" onClick={onRender}>
                            Render
                        </button>
                    )}
                </div>
                <span className={'render-indicator' + (render.rendering ? ' is-rendering' : '')} />
            </div>
            <div className="i-contents">
                <div className="i-preview-area">{contents}</div>

                <div className="i-error-area" ref={postErrorPortal}>
                    {errorContents}
                </div>
            </div>
        </div>
    );
}

namespace Preview {
    export interface Props {
        document: Document;
        render: RenderState;
        /** The part shown in the post preview; null = the first part. */
        partId: string | null;
        onPartChange: (partId: string) => void;
        /** Parts whose output was copied this session. */
        copiedParts: string[];
        onPartCopied: (partId: string) => void;
        clickToRender: (() => void) | null;
        onTargetChange: (target: RenderTarget) => void;
        onLiveChange: (live: boolean) => void;
        onRender: () => void;
    }
}

class SourceJavascript extends PureComponent<{ source: string; line?: number }> {
    extensions = [javascript()];
    editor = createRef<CodeEditor>();
    wasUnmounted = false;

    onChange = () => {};

    highlightErrorLine() {
        if (this.wasUnmounted) return;
        const cm = this.editor.current?.editor?.current?.view;
        if (!cm) {
            // umm...try again later i guess
            setTimeout(() => {
                this.highlightErrorLine();
            }, 100);
        }

        if (cm && this.props.line) {
            const lineData = cm.state.doc.line(this.props.line);
            cm.dispatch({
                selection: { anchor: lineData.from, head: lineData.to },
                scrollIntoView: true,
            });
        }
    }

    componentDidMount() {
        this.highlightErrorLine();
    }

    componentDidUpdate(prevProps: { line?: number }) {
        if (prevProps.line !== this.props.line) this.highlightErrorLine();
    }

    componentWillUnmount() {
        this.wasUnmounted = true;
    }

    render() {
        return (
            <CodeEditor
                ref={this.editor}
                readOnly
                value={this.props.source}
                onChange={this.onChange}
                extensions={this.extensions}
            />
        );
    }
}

/** Splits a part at the last block boundary where its first piece passes `fits`. */
function splitPart(document: Document, partId: string, fits: (html: string) => boolean) {
    const found = document.splittableContent(partId);
    if ('reason' in found) return found.reason;
    const contents = (found.module.data as { contents?: string }).contents ?? '';
    if (contents.includes(SPLIT_MARKER)) {
        const marked = splitHtmlAtMarker(contents);
        if (!marked) return 'Place the chapter break between content on both sides.';
        if (!fits(marked.first)) return 'The content before the chapter break is still too long.';
        document.splitPart(partId, marked.first, marked.second);
        return null;
    }
    const result = splitHtml(contents, fits);
    if (!result) {
        return 'There’s no place to split it: its first paragraph or block is already too long.';
    }
    document.splitPart(partId, result.first, result.second);
    return null;
}
