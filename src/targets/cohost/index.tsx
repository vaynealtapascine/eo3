import { SiteTargetPlugin } from '../types';
import { RenderConfig, DEFAULT_RENDER_CONFIG, CONFIG_ITEMS } from './config';
import { loadRenderer, COHOST_RENDERER_VERSION } from './live-renderer';
import { renderMarkdown, handleAsyncErrors } from './fallback-renderer';
import { CohostPreviewHeader } from './preview-header';
import { CohostPreviewFooter } from './preview-footer';
import { EXPORT_ACTIONS } from './export-actions';
import { exportPost } from './export';
import { CohostPlusIcon, CohostRegularIcon, PreviewRenderIcon } from '../../ui/components/icons';
import './styles.scss';
// @ts-ignore
import mascotAwake from './mascot-awake.svg?raw';
// @ts-ignore
import mascotAsleep from './mascot-asleep.svg?raw';

export { COHOST_RENDERER_VERSION };

const plugin: SiteTargetPlugin<RenderConfig> = {
    id: 'cohost',
    title: 'Cohost',

    initialConfig: () => DEFAULT_RENDER_CONFIG,

    loadLiveRenderer: loadRenderer,

    renderFallback: (markdown, _config, pushError) => renderMarkdown(markdown, pushError),

    scanForAsyncErrors: handleAsyncErrors,

    PreviewHeader: CohostPreviewHeader,
    PreviewFooter: CohostPreviewFooter,

    configItems: CONFIG_ITEMS,

    outputs: [{ id: 'html', label: 'HTML', typeId: 'text/html' }],

    previewCssScope: '.co-prose',

    export: exportPost,

    exportActions: EXPORT_ACTIONS,

    configSummaryIcon: (config, liveRendererActive) => {
        if (!liveRendererActive) return <PreviewRenderIcon />;
        return config.hasCohostPlus ? <CohostPlusIcon /> : <CohostRegularIcon />;
    },

    outputMascot: { awake: mascotAwake, asleep: mascotAsleep },
};

export default plugin;
