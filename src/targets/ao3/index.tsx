import React from 'react';
import { SiteTargetPlugin } from '../types';
import { RenderConfig, DEFAULT_RENDER_CONFIG, CONFIG_ITEMS } from './config';
import { loadRenderer, AO3_RENDERER_VERSION } from './live-renderer';
import { renderMarkdown, handleAsyncErrors } from './fallback-renderer';
import { Ao3PreviewHeader } from './preview-chrome';
import { EXPORT_ACTIONS } from './export-actions';
import { Ao3PlusIcon, Ao3RegularIcon, PreviewRenderIcon } from '../../ui/components/icons';
import './styles.scss';

export { AO3_RENDERER_VERSION };

const plugin: SiteTargetPlugin<RenderConfig> = {
    id: 'ao3',
    title: 'Archive of Our Own',

    initialConfig: () => DEFAULT_RENDER_CONFIG,

    loadLiveRenderer: loadRenderer,

    renderFallback: (markdown, _config, pushError) => renderMarkdown(markdown, pushError),

    scanForAsyncErrors: handleAsyncErrors,

    PreviewHeader: Ao3PreviewHeader,

    disableProseInteraction: true,

    configItems: CONFIG_ITEMS,

    exportActions: EXPORT_ACTIONS,

    configSummaryIcon: (config, liveRendererActive) => {
        if (!liveRendererActive) return <PreviewRenderIcon />;
        return config.hasAo3Plus ? <Ao3PlusIcon /> : <Ao3RegularIcon />;
    },
};

export default plugin;
