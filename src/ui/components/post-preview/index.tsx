import React, { Fragment, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderContext } from '../../render-context';
import { scopeCss } from '../../../targets/delivery/scope-css';
import { partScopeClass } from '../../../targets/delivery/shared-stylesheet';
import { diffSkinRules, liftedSkinRules } from '../../../targets/delivery/skin-record';
import { PreviewRenderIcon } from '../icons';
import './index.scss';
import { createPortal } from 'react-dom';
import { DirPopover } from '../../../uikit/dir-popover';
import { JsonValue, PostedSnapshot, WorkOutput } from '../../../document';
import { fnv1a36 } from '../../../util/hash';
import {
    ErrorMessage,
    LiveRenderFn,
    PartPosting,
    PreviewConfig,
    PushError,
    RenderResult,
    SharedPreviewSetting,
    SiteTargetConfigItem,
    SiteTargetExportOutput,
    SiteTargetPlugin,
    SiteTargetPreviewProps,
    WorkExportOutput,
} from '../../../targets/types';

export type { PreviewConfig } from '../../../targets/types';
export { makeDefaultPreviewConfig } from '../../../targets/types';

const RESET_ON_RENDER = true;

function FallbackRenderedProse({
    html,
    error,
    errorPortal,
}: {
    html: string;
    error: React.ReactNode | null;
    errorPortal: HTMLDivElement | null;
}) {
    return (
        <>
            <div
                className="inner-prose prose p-prose co-prose basic-renderer"
                role="article"
                dangerouslySetInnerHTML={{ __html: html }}
            />
            {error && errorPortal
                ? createPortal(<div className="inner-render-error">{error}</div>, errorPortal)
                : null}
        </>
    );
}

function LiveRenderedProse({
    renderId,
    rendered,
    readMore,
    onReadMoreChange,
}: {
    renderId: string;
    rendered: RenderResult;
    readMore: boolean;
    onReadMoreChange: (r: boolean) => void;
}) {
    return (
        <Fragment>
            <div
                className="inner-prose prose p-prose co-prose live-renderer"
                role="article"
                key={RESET_ON_RENDER && renderId}
            >
                {rendered.initial}
                {readMore ? rendered.expanded : null}
            </div>
            {rendered.expandedLength ? (
                <a className="prose-read-more" onClick={() => onReadMoreChange(!readMore)}>
                    {readMore ? 'read less' : 'read more'}
                </a>
            ) : null}
        </Fragment>
    );
}

function useLiveRenderer<Config extends JsonValue>(
    plugin: SiteTargetPlugin<Config>
): LiveRenderFn<Config> | null {
    const rendererPromise = useMemo(() => plugin.loadLiveRenderer?.() ?? null, [plugin]);
    const [renderer, setRenderer] = useState<{ current: LiveRenderFn<Config> | null }>({
        current: null,
    });

    useEffect(() => {
        setRenderer({ current: null });
        rendererPromise?.then((renderer) => {
            setRenderer({ current: renderer });
        });
    }, [rendererPromise]);

    return renderer.current;
}

function getLiveRendererErrorMessage(rendered: any): React.ReactNode | null {
    if (rendered?.props?.className === 'not-prose' && rendered?.props?.children?.type === 'p') {
        return rendered;
    }
    return null;
}

function MarkdownRenderer<Config extends JsonValue>({
    renderId,
    pluginId,
    liveRenderer,
    config,
    markdown,
    fallbackHtml,
    readMore,
    onReadMoreChange,
    errorPortal,
    onRender,
    onExportSource,
}: {
    renderId: string;
    pluginId: string;
    liveRenderer: LiveRenderFn<Config> | null;
    config: Config;
    markdown: string;
    fallbackHtml: string;
    readMore: boolean;
    onReadMoreChange: (b: boolean) => void;
    errorPortal: HTMLDivElement | null;
    onRender: () => void;
    onExportSource: (html: string) => void;
}) {
    const [rendered, setRendered] = useState<RenderResult | null>(null);
    const [error, setError] = useState<React.ReactNode | null>(null);

    const [triggerOnRender, setTriggerOnRender] = useState(0);

    useEffect(() => {
        if (liveRenderer) {
            const thisRenderId = renderId;

            liveRenderer(markdown, config)
                .then((result) => {
                    if (renderId !== thisRenderId) return;

                    const error =
                        getLiveRendererErrorMessage(result.initial) ||
                        getLiveRendererErrorMessage(result.expanded);
                    setError(error);

                    if (error) {
                        setRendered(null);
                    } else {
                        setRendered(result);
                    }
                })
                .catch((error) => {
                    if (renderId !== thisRenderId) return;
                    // oh well
                    console.error('live renderer error', error);
                    setRendered(null);
                    setError(<div className={`${pluginId}-message-box`}>{error.toString()}</div>);
                })
                .finally(() => {
                    setTriggerOnRender(triggerOnRender + 1);
                });
        } else {
            setTriggerOnRender(triggerOnRender + 1);
        }
    }, [liveRenderer, config, markdown]);

    useEffect(() => {
        // Serialize the accurate rendered HTML for export: the live renderer's full output
        // (initial + expanded, regardless of the read-more toggle) when it's active, else the
        // approximate fallback string.
        let source = fallbackHtml;
        if (liveRenderer && rendered) {
            try {
                source = renderToStaticMarkup(
                    <>
                        {rendered.initial}
                        {rendered.expanded}
                    </>
                );
            } catch {
                source = fallbackHtml;
            }
        }
        onExportSource(source);
        onRender();
    }, [triggerOnRender]);

    if (liveRenderer && rendered) {
        return (
            <LiveRenderedProse
                renderId={renderId}
                rendered={rendered}
                readMore={readMore}
                onReadMoreChange={onReadMoreChange}
            />
        );
    }

    return <FallbackRenderedProse html={fallbackHtml} error={error} errorPortal={errorPortal} />;
}

export function PostPreview({
    renderId,
    work,
    partId,
    error,
    stale,
    plugin,
    config,
    onConfigChange,
    readMore,
    onReadMoreChange,
    errorPortal,
    posted,
    copied,
    onPartCopied,
    onPostedChange,
    onCleanupUnusedStyles,
}: PostPreview.Props) {
    const partIndex = Math.max(
        0,
        work.parts.findIndex((p) => p.id === partId)
    );
    const part = work.parts[partIndex];
    const markdown = part.content;
    const cssInput = [work.workCss, part.css].filter(Boolean).join('\n');

    // Memoized: the fallback can be a full DOM pipeline (AO3) and shouldn't rerun on unrelated renders.
    const fallbackResult = useMemo(() => {
        const errs: ErrorMessage[] = [];
        try {
            const html = plugin.renderFallback(markdown, config.targetConfig, (id, props) =>
                errs.push({ id, props })
            );
            return { html, error: null as Error | null, errs };
        } catch (err) {
            return { html: '', error: err as Error, errs };
        }
    }, [plugin, markdown, config.targetConfig]);
    const html = fallbackResult.html;
    if (fallbackResult.error) error = fallbackResult.error;
    const renderErrors: ErrorMessage[] = [...fallbackResult.errs];

    const liveRenderer = useLiveRenderer(plugin);

    // Accurate rendered HTML of the part on screen (see MarkdownRenderer.onExportSource), kept
    // with the content it came from so a stale render of another part is never exported.
    const [renderedHtml, setRenderedHtml] = useState({ markdown: '', html: '' });
    const liveHtml = renderedHtml.markdown === markdown ? renderedHtml.html : null;
    const exportResult = useMemo(() => {
        const errs: ErrorMessage[] = [];
        try {
            const output = plugin.export(
                {
                    parts: work.parts.map((p) => ({
                        id: p.id,
                        title: p.title,
                        source: p.content,
                        html: p.id === part.id ? liveHtml : null,
                        css: p.css,
                        posted: p.posted,
                    })),
                    workCss: work.workCss,
                    cssSources: work.cssSources,
                    skinRecord: work.skinRecord,
                    config: config.targetConfig,
                },
                (id, props) => errs.push({ id, props })
            );
            return { output, error: null as Error | null, errs };
        } catch (err) {
            const output: WorkExportOutput = { parts: new Map(), work: new Map() };
            return { output, error: err as Error, errs };
        }
    }, [plugin, work, part.id, liveHtml, config.targetConfig]);

    // The part on screen's own artifacts plus the work-wide ones, which is what the chrome shows.
    const exportOutput: SiteTargetExportOutput = new Map([
        ...(exportResult.output.parts.get(part.id) ?? []),
        ...exportResult.output.work,
    ]);
    if (exportResult.error) error = exportResult.error;
    renderErrors.push(...exportResult.errs);

    // Inject the target's CSS outputs (AO3's workskin) or, if it has none (cohost inlines styles),
    // the authored CSS, scoped under previewCssScope.
    const cssTypedOutputs = plugin.outputs
        .filter((o) => o.typeId === 'text/css')
        .map((o) => exportOutput.get(o.id))
        .filter((s): s is string => !!s);
    const styleSources = cssTypedOutputs.length ? cssTypedOutputs : cssInput ? [cssInput] : [];
    const styleOutputs = styleSources.map((css) =>
        plugin.previewCssScope ? scopeCss(css, plugin.previewCssScope) : css
    );
    const needsPartScope =
        work.parts.length > 1 &&
        plugin.outputs.some((output) => output.scope === 'work' && output.typeId === 'text/css');

    const proseContainer = useRef<HTMLDivElement>(null);
    const [asyncErrors, setAsyncErrors] = useState<ErrorMessage[]>([]);

    const newAsyncErrors = asyncErrors.slice();
    const pushAsyncError: PushError = (id, props) => {
        // we mutate to fix janky update coalescion issues
        newAsyncErrors.push({ id, props });
        setAsyncErrors(newAsyncErrors);
    };

    const pushAsyncErrorRef = useRef(pushAsyncError);
    pushAsyncErrorRef.current = pushAsyncError;
    const asyncErrorRenderId = useRef(0);

    const onRender = () => {
        newAsyncErrors.splice(0);
        setAsyncErrors(newAsyncErrors);
        const thisRenderId = ++asyncErrorRenderId.current;

        if (proseContainer.current && plugin.scanForAsyncErrors) {
            plugin.scanForAsyncErrors(proseContainer.current, (id, props) => {
                if (thisRenderId !== asyncErrorRenderId.current) return;
                pushAsyncErrorRef.current(id, props);
            });
        }
    };

    const supports = (s: SharedPreviewSetting) => !!plugin.previewSettings?.includes(s);
    const darkTheme = supports('darkTheme') && config.darkTheme;
    const siteDarkTheme = supports('siteDarkTheme') && config.siteDarkTheme;
    const reducedMotion = supports('prefersReducedMotion') && config.prefersReducedMotion;

    const postedHtml = exportOutput.get(plugin.outputs[0].id) ?? '';
    const postedHtmlHash = fnv1a36(postedHtml);
    const skinOutput = plugin.outputs.find(
        (output) => output.scope === 'work' && output.typeId === 'text/css'
    );
    const skinCss = skinOutput ? exportOutput.get(skinOutput.id) ?? '' : null;
    const unusedStyles = skinOutput
        ? Object.entries(work.skinRecord)
              .filter(([name]) => !work.parts.some((p) => p.posted?.classes.includes(name)))
              .map(([className, css]) => ({ className, css }))
        : [];
    const posting: PartPosting = {
        posted,
        copiedUnmarked: copied && !posted,
        changedSincePosted: !!posted && !exportResult.error && posted.htmlHash !== postedHtmlHash,
        skinDiff:
            posted?.skinCss !== undefined && skinCss !== null
                ? diffSkinRules(posted.skinCss, skinCss)
                : undefined,
        unusedStyles,
        cleanupUnusedStyles: onCleanupUnusedStyles,
        onCopied: (outputId) => {
            if (plugin.outputs.find((o) => o.id === outputId)?.scope === 'part') {
                onPartCopied(part.id);
            }
        },
        markPosted: () => {
            const classes = liftedClasses(postedHtml);
            const rules = skinCss === null ? {} : liftedSkinRules(skinCss);
            onPostedChange(
                part.id,
                {
                    at: new Date().toLocaleDateString('en-CA'), // YYYY-MM-DD, local
                    classes,
                    htmlHash: postedHtmlHash,
                    ...(skinCss === null ? {} : { skinCss }),
                },
                Object.fromEntries(
                    classes.filter((name) => rules[name]).map((name) => [name, rules[name]])
                )
            );
        },
        unmarkPosted: () => onPostedChange(part.id, null, {}),
    };

    const previewProps: SiteTargetPreviewProps<any> = {
        plugin,
        markdown,
        exportOutput,
        part: { index: partIndex, count: work.parts.length, title: part.title },
        posting,
        config: config.targetConfig,
        previewConfig: config,
        onPreviewConfigChange: onConfigChange,
        hasLiveRenderer: !!liveRenderer,
        error,
        renderErrors,
        asyncErrors,
    };

    const proseRenderer = (
        <MarkdownRenderer
            renderId={renderId}
            pluginId={plugin.id}
            liveRenderer={config.useLiveRenderer ? liveRenderer : null}
            config={config.targetConfig}
            markdown={markdown}
            fallbackHtml={html}
            readMore={readMore}
            onReadMoreChange={onReadMoreChange}
            errorPortal={errorPortal}
            onRender={onRender}
            onExportSource={(html) => setRenderedHtml({ markdown, html })}
        />
    );

    return (
        <div
            className={
                'post-preview' +
                ` target-${plugin.id}` +
                (stale ? ' is-stale' : '') +
                (darkTheme ? ' dark-theme' : '') +
                (siteDarkTheme ? ' is-site-dark-theme' : '')
            }
        >
            {plugin.PreviewHeader ? <plugin.PreviewHeader {...previewProps} /> : null}
            {error ? (
                <div className="prose-container p-prose-outer">
                    <div className="inner-prose prose p-prose co-prose is-error">
                        {error
                            .toString()
                            .split('\n')
                            .map((line, i) => (
                                <div key={i}>{line}</div>
                            ))}
                    </div>
                </div>
            ) : (
                <div
                    className="prose-container p-prose-outer co-themed-box"
                    ref={proseContainer}
                    data-theme={darkTheme ? 'dark' : 'light'}
                    data-media-color-scheme={siteDarkTheme ? 'dark' : 'light'}
                    style={plugin.disableProseInteraction ? { pointerEvents: 'none' } : undefined}
                >
                    <DynamicStyles reducedMotion={reducedMotion} />
                    {styleOutputs.map((css, i) => (
                        <style key={i}>{css}</style>
                    ))}
                    {needsPartScope ? (
                        <div className={partScopeClass(part.id)}>{proseRenderer}</div>
                    ) : (
                        proseRenderer
                    )}
                </div>
            )}
            {plugin.PreviewFooter ? <plugin.PreviewFooter {...previewProps} /> : null}
        </div>
    );
}

namespace PostPreview {
    export interface Props {
        renderId: string;
        work: WorkOutput;
        /** The part to show; falls back to the first part if it no longer exists. */
        partId: string | null;
        error?: Error | null;
        stale?: boolean;
        plugin: SiteTargetPlugin<any>;
        config: PreviewConfig;
        onConfigChange: (c: PreviewConfig) => void;
        readMore: boolean;
        onReadMoreChange: (b: boolean) => void;
        errorPortal: HTMLDivElement | null;
        /** Posted state of the part on screen. */
        posted: PostedSnapshot | null;
        /** Whether the part on screen was copied this session. */
        copied: boolean;
        onPartCopied: (partId: string) => void;
        onPostedChange: (
            partId: string,
            posted: PostedSnapshot | null,
            skinRules: Record<string, string>
        ) => void;
        onCleanupUnusedStyles: () => void;
    }
}

/** The `eo3-*` classes an exported part's HTML references, sorted. */
function liftedClasses(html: string): string[] {
    const classes = new Set<string>();
    for (const [, value] of html.matchAll(/ class="([^"]*)"/g)) {
        for (const name of value.split(/\s+/)) {
            if (name.startsWith('eo3-') && !name.startsWith('eo3-part-')) classes.add(name);
        }
    }
    return [...classes].sort();
}

type UnifiedConfigItem = SiteTargetConfigItem<PreviewConfig>;

function buildConfigItems(plugin: SiteTargetPlugin<any>): { [k: string]: UnifiedConfigItem } {
    const items: { [k: string]: UnifiedConfigItem } = {
        useLiveRenderer: {
            short: null,
            label: `${plugin.title} Renderer`,
            description: `Uses ${plugin.title}’s real renderer where possible. Turn this off to test with an approximate renderer that is less strict.`,
            requiresLiveRenderer: true,
            get: (c) => c.useLiveRenderer,
            set: (c, v) => ({ ...c, useLiveRenderer: v }),
        },
        prefersReducedMotion: {
            short: ['motion ✓', 'reduced motion'],
            label: 'Reduced Motion',
            description:
                'Disables the `spin` animation and enables the `pulse` animation. This simulates the effect of @media (prefers-reduced-motion: reduce).',
            renderOnChange: true,
            get: (c) => c.prefersReducedMotion,
            set: (c, v) => ({ ...c, prefersReducedMotion: v }),
        },
        siteDarkTheme: {
            short: null,
            label: 'Dark Site Theme',
            description:
                'Sets the site theme to the dark theme. Controlled by the OS theme by default. Affects variables like `--color-text`.',
            get: (c) => c.siteDarkTheme,
            set: (c, v) => ({ ...c, siteDarkTheme: v }),
        },
    };
    for (const setting of ['prefersReducedMotion', 'siteDarkTheme'] as const) {
        if (!plugin.previewSettings?.includes(setting)) delete items[setting];
    }

    for (const [k, item] of Object.entries(plugin.configItems ?? {})) {
        items[k] = {
            ...item,
            get: (c) => item.get(c.targetConfig),
            set: (c, v) => ({ ...c, targetConfig: item.set(c.targetConfig, v) }),
        };
    }

    return items;
}

export function RenderConfigEditor({
    plugin,
    hasLiveRenderer,
    config,
    onConfigChange,
}: {
    plugin: SiteTargetPlugin<any>;
    hasLiveRenderer: boolean;
    config: PreviewConfig;
    onConfigChange: (c: PreviewConfig) => void;
}) {
    const configButton = useRef<HTMLButtonElement>(null);
    const [configOpen, setConfigOpen] = useState(false);

    const configItems = useMemo(() => buildConfigItems(plugin), [plugin]);

    const items = [];

    const liveRendererActive = hasLiveRenderer && config.useLiveRenderer;
    items.push(
        <Fragment key="icon">
            {liveRendererActive && plugin.configSummaryIcon ? (
                plugin.configSummaryIcon(config.targetConfig, true)
            ) : (
                <PreviewRenderIcon />
            )}
        </Fragment>
    );

    for (const k in configItems) {
        const v = configItems[k];

        if (!v.short) continue;
        if (v.requiresLiveRenderer && !liveRendererActive) continue;
        const enabled = v.get(config);
        const label = enabled ? v.short[1] : v.short[0];
        if (!label) continue;
        items.push(
            <div className="config-preview-item" key={k}>
                {label}
            </div>
        );
    }

    return (
        <div className="render-config">
            <button
                ref={configButton}
                className="i-config-button"
                onClick={() => setConfigOpen(true)}
            >
                <svg className="config-icon" viewBox="0 0 20 20">
                    <path
                        fill="currentcolor"
                        fillRule="evenodd"
                        d="M11 2a1 1 0 0 1 1 1v1.342A5.994 5.994 0 0 1 13.9 5.439l1.163-.671a1 1 0 0 1 1.366.366l1 1.732a1 1 0 0 1-.366 1.366l-1.162.672a6.034 6.034 0 0 1 0 2.192l1.162.672a1 1 0 0 1 .366 1.366l-1 1.732a1 1 0 0 1-1.366.366l-1.163-.671A5.994 5.994 0 0 1 12 15.658V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-1.342A5.994 5.994 0 0 1 6.1 14.561l-1.163.671a1 1 0 0 1-1.366-.366l-1-1.732a1 1 0 0 1 .366-1.366l1.162-.672a6.034 6.034 0 0 1 0-2.192l-1.162-.672a1 1 0 0 1-.366-1.366l1-1.732a1 1 0 0 1 1.366-.366l1.163.671A5.994 5.994 0 0 1 8 4.342V3a1 1 0 0 1 1-1h2Zm-1 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"
                    />
                </svg>
                {items}
            </button>
            <DirPopover
                anchor={configButton.current}
                anchorBias="left"
                open={configOpen}
                onClose={() => setConfigOpen(false)}
            >
                <RenderConfigPopover
                    plugin={plugin}
                    configItems={configItems}
                    hasLiveRenderer={hasLiveRenderer}
                    config={config}
                    onConfigChange={onConfigChange}
                />
            </DirPopover>
        </div>
    );
}

function RenderConfigPopover({
    plugin,
    configItems,
    hasLiveRenderer,
    config,
    onConfigChange,
}: {
    plugin: SiteTargetPlugin<any>;
    configItems: { [k: string]: UnifiedConfigItem };
    hasLiveRenderer: boolean;
    config: PreviewConfig;
    onConfigChange: (c: PreviewConfig) => void;
}) {
    const renderContext = useContext(RenderContext);
    const baseId = useId();

    return (
        <div className="i-config-contents">
            <div className="i-config-title">Post Preview Settings</div>
            {!hasLiveRenderer && plugin.loadLiveRenderer && (
                <div className="i-renderer-unavailable">
                    <div className="i-icon">
                        <PreviewRenderIcon />
                    </div>
                    <div>{plugin.title} renderer unavailable</div>
                </div>
            )}
            {Object.entries(configItems).map(([k, v]) => {
                if (v.requiresLiveRenderer && !hasLiveRenderer) return null;
                if (k !== 'useLiveRenderer' && v.requiresLiveRenderer && !config.useLiveRenderer)
                    return null;
                const checkboxId = `${baseId}-${k}`;
                return (
                    <div className="config-item" key={k}>
                        <div className="item-header">
                            <input
                                id={checkboxId}
                                type="checkbox"
                                checked={v.get(config)}
                                onChange={(e) => {
                                    const value = (e.target as HTMLInputElement).checked;
                                    onConfigChange(v.set(config, value));
                                    if (v.renderOnChange) {
                                        renderContext.scheduleRender();
                                    }
                                }}
                            />{' '}
                            <label htmlFor={checkboxId}>{v.label}</label>
                        </div>
                        <div className="item-description">{v.description}</div>
                    </div>
                );
            })}
        </div>
    );
}

const globalDynamicStyles = (() => {
    // we'll just create two global style tags and set their disabled property,
    // because doing it any other way causes glitches in e.g. Firefox

    const styleMotion = document.createElement('style');
    const styleReduced = document.createElement('style');

    styleMotion.className = styleReduced.className = 'post-dynamic-styles';

    styleMotion.innerHTML = `
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
    `;
    styleReduced.innerHTML = `
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
    `;
    document.head.append(styleMotion, styleReduced);

    const setReducedMotion = (reduced: boolean) => {
        styleMotion.disabled = reduced;
        styleReduced.disabled = !reduced;
    };
    setReducedMotion(false);

    return { setReducedMotion };
})();

function DynamicStyles({ reducedMotion }: { reducedMotion: boolean }) {
    useEffect(() => {
        globalDynamicStyles.setReducedMotion(reducedMotion);
    }, [reducedMotion]);

    return null;
}
