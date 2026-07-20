import React, { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RenderContext } from '../../render-context';
import { PreviewRenderIcon } from '../icons';
import './index.scss';
import { createPortal } from 'react-dom';
import { DirPopover } from '../../../uikit/dir-popover';
import { JsonValue } from '../../../document';
import {
    ErrorMessage,
    LiveRenderFn,
    PreviewConfig,
    PushError,
    RenderResult,
    SiteTargetPlugin,
    SiteTargetPreviewProps,
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
                ? createPortal(<div className="inner-ao3-error">{error}</div>, errorPortal)
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
                className="inner-prose prose p-prose co-prose ao3-renderer"
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
    markdown,
    error,
    stale,
    plugin,
    config,
    onConfigChange,
    readMore,
    onReadMoreChange,
    errorPortal,
}: PostPreview.Props) {
    let html = '';
    const renderErrors: ErrorMessage[] = [];
    try {
        html = plugin.renderFallback(markdown, config.targetConfig, (id, props) =>
            renderErrors.push({ id, props })
        );
    } catch (err) {
        error = err as Error;
    }

    const liveRenderer = useLiveRenderer(plugin);

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

    const previewProps: SiteTargetPreviewProps<any> = {
        plugin,
        markdown,
        html,
        config: config.targetConfig,
        previewConfig: config,
        onPreviewConfigChange: onConfigChange,
        hasLiveRenderer: !!liveRenderer,
        error,
        renderErrors,
        asyncErrors,
    };

    return (
        <div
            className={
                'post-preview' +
                ` target-${plugin.id}` +
                (stale ? ' is-stale' : '') +
                (config.darkTheme ? ' dark-theme' : '') +
                (config.siteDarkTheme ? ' is-site-dark-theme' : '')
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
                    data-theme={config.darkTheme ? 'dark' : 'light'}
                    data-media-color-scheme={config.siteDarkTheme ? 'dark' : 'light'}
                    style={plugin.disableProseInteraction ? { pointerEvents: 'none' } : undefined}
                >
                    <DynamicStyles config={config} />
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
                    />
                </div>
            )}
            {plugin.PreviewFooter ? <plugin.PreviewFooter {...previewProps} /> : null}
        </div>
    );
}

namespace PostPreview {
    export interface Props {
        renderId: string;
        markdown: string;
        error?: Error | null;
        stale?: boolean;
        plugin: SiteTargetPlugin<any>;
        config: PreviewConfig;
        onConfigChange: (c: PreviewConfig) => void;
        readMore: boolean;
        onReadMoreChange: (b: boolean) => void;
        errorPortal: HTMLDivElement | null;
    }
}

interface UnifiedConfigItem {
    short: [string | null, string] | null;
    label: string;
    description: string;
    requiresLiveRenderer?: boolean;
    renderOnChange?: boolean;
    get(config: PreviewConfig): boolean;
    set(config: PreviewConfig, value: boolean): PreviewConfig;
}

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

    for (const k in plugin.configItems) {
        const item = plugin.configItems[k];
        items[k] = {
            short: item.short,
            label: item.label,
            description: item.description,
            requiresLiveRenderer: item.requiresLiveRenderer,
            renderOnChange: item.renderOnChange,
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
        <>
            {liveRendererActive && plugin.configSummaryIcon ? (
                plugin.configSummaryIcon(config.targetConfig, true)
            ) : (
                <PreviewRenderIcon />
            )}
        </>
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

    return (
        <div className="i-config-contents">
            <div className="i-config-title">Post Preview Settings</div>
            {!hasLiveRenderer && (
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
                const checkboxId = Math.random().toString(36);
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

function DynamicStyles({ config }: { config: PreviewConfig }) {
    useEffect(() => {
        globalDynamicStyles.setReducedMotion(config.prefersReducedMotion);
    }, [config]);

    return null;
}
