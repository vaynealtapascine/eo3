import { ComponentType, ReactNode } from 'react';
import { JsonValue } from '../document';

export type SiteTargetId = string;

/** Raw output from a target's "live" renderer (e.g. the site's real compiled markdown renderer). */
export interface RenderResult {
    initial: any;
    expanded: any;
    initialLength: number;
    expandedLength: number;
}

export interface ErrorMessage {
    id: string;
    props: { [k: string]: any };
}

export type PushError = (id: string, props: { [k: string]: any }) => void;

/** Renders markdown using the target site's real, live-loaded renderer. */
export type LiveRenderFn<Config> = (markdown: string, config: Config) => Promise<RenderResult>;

/** Describes one input or output slot of a site target (e.g. its HTML or Workskin CSS output). */
export interface SiteTargetIO {
    id: string;
    label: string;
    /** The `Data.typeId` of the artifact (e.g. 'text/html', 'text/css'). */
    typeId: string;
}

export interface SiteTargetExportInput<Config> {
    /** Accurate rendered HTML from the active renderer (live serialized, else the fallback). */
    html: string;
    /** Assembled authored CSS from every CSS input to the output, in module order. */
    css: string;
    config: Config;
}

/** The finished export artifacts, keyed by `SiteTargetPlugin.outputs[].id`. */
export type SiteTargetExportOutput = Map<string, string>;

export interface SiteTargetConfigItem<Config> {
    /** [offLabel, onLabel] shown as a compact summary chip in the config button; null to omit from the summary. */
    short: [string | null, string] | null;
    label: string;
    description: string;
    /** Hide this item unless the target's live renderer is currently active. */
    requiresLiveRenderer?: boolean;
    /** Trigger an immediate re-render when this item changes. */
    renderOnChange?: boolean;
    get(config: Config): boolean;
    set(config: Config, value: boolean): Config;
}

export interface SiteTargetExportAction {
    id: string;
    label: string;
    /** Which entry of the target's `outputs` this action copies. */
    outputId: string;
    getWarnings?(data: string): string[];
}

export interface PreviewConfig {
    target: SiteTargetId;
    targetConfig: JsonValue;
    useLiveRenderer: boolean;
    prefersReducedMotion: boolean;
    darkTheme: boolean;
    siteDarkTheme: boolean;
}

export function makeDefaultPreviewConfig(plugin: SiteTargetPlugin<any>): PreviewConfig {
    return {
        target: plugin.id,
        targetConfig: plugin.initialConfig(),
        useLiveRenderer: true,
        prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        darkTheme: window.matchMedia('(prefers-color-scheme: dark)').matches,
        siteDarkTheme: window.matchMedia('(prefers-color-scheme: dark)').matches,
    };
}

export interface SiteTargetPreviewProps<Config extends JsonValue> {
    plugin: SiteTargetPlugin<Config>;
    markdown: string;
    /**
     * The finished export artifacts for this target, keyed by `outputs[].id`. The primary
     * output (`outputs[0].id`) is what page-chrome mockups embed; other outputs are exported
     * via their copy buttons.
     */
    exportOutput: SiteTargetExportOutput;
    config: Config;
    previewConfig: PreviewConfig;
    onPreviewConfigChange: (c: PreviewConfig) => void;
    hasLiveRenderer: boolean;
    /** Top-level render error, if any (e.g. disables export actions). */
    error: Error | null | undefined;
    renderErrors: ErrorMessage[];
    asyncErrors: ErrorMessage[];
}

/**
 * A render target: a site/platform EO3 can preview output as. Mirrors the shape of
 * `ModulePlugin<T>` (see document.ts) so new targets can be added the same way new
 * content-pipeline modules are: a self-contained, lazily-loaded module.
 */
export interface SiteTargetPlugin<Config extends JsonValue = JsonValue> {
    id: string;
    title: string;

    /** Default config value for a fresh preview. */
    initialConfig(): Config;

    /** Attempts to load the target's real, live renderer. Omit if this target has none. */
    loadLiveRenderer?(): Promise<LiveRenderFn<Config>>;

    /** Always-available local approximation, used when the live renderer is unavailable or disabled. */
    renderFallback(markdown: string, config: Config, pushError: PushError): string;

    /**
     * The export artifacts this target emits, in order. The first is the primary output
     * (drives the preview mockup). cohost emits one (HTML); AO3 emits two (HTML + Workskin
     * CSS); other targets may emit any number.
     */
    outputs: SiteTargetIO[];

    /**
     * Selector the preview's injected CSS is scoped under, so it applies only within this
     * target's mockup and gains that selector's specificity (AO3: `#workskin`, matching how
     * AO3 wraps a Work Skin; cohost: its prose container). Omit to inject CSS unscoped.
     */
    previewCssScope?: string;

    /**
     * Produces the finished, site-ready export artifacts from the accurately-rendered HTML
     * plus the authored CSS. This is where site-specific sanitation and CSS strategy live
     * (AO3: lift/scope into a workskin; cohost: inline everything into style attributes).
     */
    export(input: SiteTargetExportInput<Config>, pushError: PushError): SiteTargetExportOutput;

    /** Scans rendered DOM for problems the string-level fallback renderer can't catch (e.g. broken image loads). */
    scanForAsyncErrors?(container: HTMLElement, pushError: PushError): void;

    /** Rendered before the shared prose comparison section (e.g. a full page-chrome mockup, or a settings bar). */
    PreviewHeader?: ComponentType<SiteTargetPreviewProps<Config>>;

    /** Rendered after the shared prose comparison section (e.g. a footer with size/export actions). */
    PreviewFooter?: ComponentType<SiteTargetPreviewProps<Config>>;

    /**
     * Disables pointer events on the shared prose comparison section. Set this when
     * `PreviewHeader` already renders its own interactive, fully-chromed copy of the
     * content (e.g. AO3's page mockup) and the comparison section is purely visual.
     */
    disableProseInteraction?: boolean;

    /** Config toggles shown in the preview settings popover. */
    configItems: { [k: string]: SiteTargetConfigItem<Config> };

    /** Raw SVG markup for the module graph's output node while this target is selected. */
    outputMascot: {
        /** Shown once there's rendered output, while the node isn't being interacted with. */
        awake: string;
        /** Shown while there's no output yet, or while the node is being dragged/patted. */
        asleep: string;
    };

    /** Icon shown on the config button summarizing the current config; defaults to a generic icon if omitted. */
    configSummaryIcon?(config: Config, liveRendererActive: boolean): ReactNode;

    /** "Copy as X" export actions specific to this target (e.g. AO3's Copy HTML / Copy Workskin CSS). */
    exportActions?: SiteTargetExportAction[];
}
