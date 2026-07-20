import { SiteTargetConfigItem } from '../types';

export type RenderConfig = {
    disableEmbeds: boolean;
    externalLinksInNewTab: boolean;
    hasCohostPlus: boolean;
};

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
    disableEmbeds: false,
    externalLinksInNewTab: true,
    hasCohostPlus: true,
};

export const CONFIG_ITEMS: { [k: string]: SiteTargetConfigItem<RenderConfig> } = {
    hasCohostPlus: {
        short: null,
        label: 'Cohost Plus!',
        description: 'Enables Cohost Plus! features (emoji). Use this if you have Cohost Plus!',
        requiresLiveRenderer: true,
        get: (config) => config.hasCohostPlus,
        set: (config, value) => ({ ...config, hasCohostPlus: value }),
    },
    disableEmbeds: {
        short: [null, 'no embeds'],
        label: 'Disable Embeds',
        description:
            'Disables Iframely embeds in the post. This is a feature in Cohost settings. Though, quite frankly, it’s not very useful here.',
        requiresLiveRenderer: true,
        get: (config) => config.disableEmbeds,
        set: (config, value) => ({ ...config, disableEmbeds: value }),
    },
};
