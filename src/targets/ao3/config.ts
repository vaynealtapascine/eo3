import { SiteTargetConfigItem } from '../types';

export type RenderConfig = {
    disableEmbeds: boolean;
    externalLinksInNewTab: boolean;
    hasAo3Plus: boolean;
};

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
    disableEmbeds: false,
    externalLinksInNewTab: true,
    hasAo3Plus: true,
};

export const CONFIG_ITEMS: { [k: string]: SiteTargetConfigItem<RenderConfig> } = {
    hasAo3Plus: {
        short: null,
        label: 'AO3 Plus!',
        description: 'Enables AO3 Plus! features (emoji). Use this if you have AO3 Plus!',
        requiresLiveRenderer: true,
        get: (config) => config.hasAo3Plus,
        set: (config, value) => ({ ...config, hasAo3Plus: value }),
    },
    disableEmbeds: {
        short: [null, 'no embeds'],
        label: 'Disable Embeds',
        description:
            'Disables Iframely embeds in the post. This is a feature in AO3 settings. Though, quite frankly, it’s not very useful here.',
        requiresLiveRenderer: true,
        get: (config) => config.disableEmbeds,
        set: (config, value) => ({ ...config, disableEmbeds: value }),
    },
};
