import { SiteTargetPlugin } from './types';
import { lazy } from '../util/lazy';

export type SiteTargetDef = {
    title: string;
    description: string;
    load: () => Promise<SiteTargetPlugin<any>>;
};

export const SITE_TARGETS: { [k: string]: SiteTargetDef } = {
    ao3: {
        title: 'Archive of Our Own',
        description: 'Renders using AO3’s real markdown renderer where possible.',
        load: lazy(() => import('./ao3')),
    },
    cohost: {
        title: 'Cohost',
        description:
            'Renders using cohost’s real markdown renderer where possible. Cohost shut down in January 2025, so the live renderer will only work if EO3_COHOST_STATIC points at a preserved mirror of its static assets — otherwise this falls back to the approximate renderer.',
        load: lazy(() => import('./cohost')),
    },
};

export const DEFAULT_SITE_TARGET = 'ao3';
