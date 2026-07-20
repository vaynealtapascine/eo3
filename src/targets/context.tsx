import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { SiteTargetPlugin, SiteTargetId } from './types';
import { SITE_TARGETS, DEFAULT_SITE_TARGET } from './index';

export interface SiteTargetState {
    id: SiteTargetId;
    /** null while the target's module is still loading. */
    plugin: SiteTargetPlugin<any> | null;
    setId: (id: SiteTargetId) => void;
}

const SiteTargetContext = createContext<SiteTargetState>({
    id: DEFAULT_SITE_TARGET,
    plugin: null,
    setId: () => {},
});

/**
 * Owns which SiteTarget is currently selected and its loaded plugin, so any part of
 * the UI (preview, module graph, ...) can react to the current target from one place
 * instead of each tracking its own copy.
 */
export function SiteTargetProvider({ children }: { children: ReactNode }) {
    const [id, setId] = useState<SiteTargetId>(DEFAULT_SITE_TARGET);
    const [plugin, setPlugin] = useState<SiteTargetPlugin<any> | null>(null);

    useEffect(() => {
        let cancelled = false;
        setPlugin(null);
        SITE_TARGETS[id].load().then((loaded) => {
            if (!cancelled) setPlugin(loaded);
        });
        return () => {
            cancelled = true;
        };
    }, [id]);

    return (
        <SiteTargetContext.Provider value={{ id, plugin, setId }}>
            {children}
        </SiteTargetContext.Provider>
    );
}

export function useSiteTarget(): SiteTargetState {
    return useContext(SiteTargetContext);
}
