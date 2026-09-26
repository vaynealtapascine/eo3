import { ComponentType, ReactNode } from 'react';
import { CssSourceOutput, JsonValue, PostedSnapshot } from '../document';

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

/** Describes one output slot of a site target (e.g. its chapter HTML or its Work Skin CSS). */
export interface SiteTargetIO {
    id: string;
    label: string;
    /** The `Data.typeId` of the artifact (e.g. 'text/html', 'text/css'). */
    typeId: string;
    /** 'part': one per part (a chapter's HTML); 'work': one for the whole work (AO3's Work Skin). */
    scope: 'part' | 'work';
}

export interface WorkExportInput<Config> {
    parts: PartExportInput[];
    /** Authored CSS reaching every part, in module order. */
    workCss: string;
    /** CSS reach by source; lets shared stylesheets scope rules that reach only some parts. */
    cssSources?: CssSourceOutput[];
    /** Lifted rules captured when parts were marked posted. */
    skinRecord?: Record<string, string>;
    /** Imported classes to keep even when their already-posted chapters are not imported. */
    protectedSkinClasses?: string[];
    config: Config;
}

export interface PartExportInput {
    id: string;
    title: string;
    /** The raw module-graph output, for targets whose export re-runs their own pipeline (AO3). */
    source: string;
    /**
     * Accurate rendered HTML from the live renderer, for the part on screen; null for the others,
     * which the target renders with its fallback if it needs HTML.
     */
    html: string | null;
    /** Authored CSS reaching this part but not every part, in module order. */
    css: string;
    posted?: PostedSnapshot | null;
}

export interface WorkExportOutput {
    /** Per part id: its 'part'-scoped artifacts, keyed by `outputs[].id`. */
    parts: Map<string, SiteTargetExportOutput>;
    /** The 'work'-scoped artifacts, keyed by `outputs[].id`. */
    work: SiteTargetExportOutput;
}

/** Finished export artifacts, keyed by `SiteTargetPlugin.outputs[].id`. */
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

/** Preview settings shared across targets; each target opts into the ones its styles respond to. */
export type SharedPreviewSetting = 'darkTheme' | 'siteDarkTheme' | 'prefersReducedMotion';

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

export interface PartSizing {
    /** Characters in the part's primary output. */
    size: number;
    /** The site's approximate limit for one part, or null if it has none. */
    max: number | null;
    /**
     * Splits the part so its first piece fits comfortably under the limit, moving the rest into
     * a new part after it. Returns why it couldn't, or null once it has.
     */
    split(): string | null;
}

export interface PartPosting {
    posted: PostedSnapshot | null;
    /** The part's output was copied this session but the part isn't marked as posted. */
    copiedUnmarked: boolean;
    /** The part is marked as posted but its output has changed since. */
    changedSincePosted: boolean;
    /** Work Skin rule changes since the part was marked posted. */
    skinDiff?: { added: number; removed: number };
    /** Recorded lifted rules no posted part needs. */
    unusedStyles?: { className: string; css: string }[];
    protectedStyles?: { className: string; css: string }[];
    cleanupUnusedStyles?(): void;
    pruneProtectedStyles?(names: string[]): void;
    /** Call after an export action copied `outputId`. */
    onCopied(outputId: string): void;
    markPosted(): void;
    unmarkPosted(): void;
}

export interface SiteTargetPreviewProps<Config extends JsonValue> {
    plugin: SiteTargetPlugin<Config>;
    markdown: string;
    /**
     * The finished artifacts for the part on screen plus the work-wide ones, keyed by
     * `outputs[].id`. The primary output (`outputs[0].id`) is what page-chrome mockups embed;
     * the others are exported via their copy buttons.
     */
    exportOutput: SiteTargetExportOutput;
    /** The part on screen: its position (0-based) and how many parts the work has. */
    part: { index: number; count: number; title: string };
    /** Posted state of the part on screen; chrome shows it next to its copy buttons. */
    posting: PartPosting;
    /** Size of the part on screen against the site's limit, and splitting it. */
    sizing: PartSizing;
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
     * (drives the preview mockup). cohost emits one per post (HTML); AO3 emits one per chapter
     * (HTML) plus one Work Skin; other targets may emit any number.
     */
    outputs: SiteTargetIO[];

    /** What a part is called on this site ("Chapter", "Post"). */
    partLabel: string;

    /** Approximate size limit of one part's primary output, in characters, if the site has one. */
    partMaxChars?: number;

    /**
     * Selector the preview's injected CSS is scoped under, so it applies only within this
     * target's mockup and gains that selector's specificity (AO3: `#workskin`, matching how
     * AO3 wraps a Work Skin; cohost: its prose container). Omit to inject CSS unscoped.
     */
    previewCssScope?: string;

    /**
     * Produces the finished, site-ready artifacts for the whole work from each part's content
     * plus the authored CSS. This is where site-specific sanitation and CSS strategy live
     * (AO3: lift into one Work Skin shared by every chapter; cohost: inline styles per post).
     */
    export(input: WorkExportInput<Config>, pushError: PushError): WorkExportOutput;

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

    /** Shared preview settings this target supports; the others are neither shown nor applied. */
    previewSettings?: SharedPreviewSetting[];

    /** Config toggles shown in the preview settings popover. */
    configItems?: { [k: string]: SiteTargetConfigItem<Config> };

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
