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
        description:
            'Renders with a faithful port of AO3’s HTML sanitizer and Work Skin CSS validator.',
        load: lazy(() => import('./ao3')),
    },
    wafrn: {
        title: 'wafrn',
        description:
            'Renders with wafrn’s own sanitizer settings. Each post can carry a <style> block, scoped to that post. Readers with reduced motion turned on, and other fediverse servers, may show posts without their styles.',
        load: lazy(() => import('./wafrn')),
    },
    cohost: {
        title: 'Cohost',
        description:
            'Renders using cohost’s real markdown renderer where possible. Cohost shut down in January 2025, so the live renderer will only work if EO3_COHOST_STATIC points at a preserved mirror of its static assets — otherwise this falls back to the approximate renderer.',
        load: lazy(() => import('./cohost')),
    },
};

export const DEFAULT_SITE_TARGET = 'ao3';
