import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { SiteTargetPlugin, SiteTargetId } from './types';
import { SITE_TARGETS, DEFAULT_SITE_TARGET } from './index';
import { listProfiles, PROFILE_TARGET_PREFIX, subscribeProfiles } from './profile/store';

/** A built-in target, or one built from a custom profile (`profile:<id>`); null if it's gone. */
async function loadTarget(id: SiteTargetId): Promise<SiteTargetPlugin<any> | null> {
    if (SITE_TARGETS[id]) return SITE_TARGETS[id].load();
    const profile = listProfiles().find((p) => PROFILE_TARGET_PREFIX + p.id === id);
    if (!profile) return null;
    const { createProfileTarget } = await import('./profile/target');
    return createProfileTarget(profile);
}

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

    // Bumped when custom profiles change, so an edited profile's target is rebuilt.
    const [profilesVersion, setProfilesVersion] = useState(0);
    useEffect(() => subscribeProfiles(() => setProfilesVersion((v) => v + 1)), []);

    useEffect(() => {
        let cancelled = false;
        setPlugin(null);
        loadTarget(id).then((loaded) => {
            if (cancelled) return;
            if (loaded) setPlugin(loaded);
            else setId(DEFAULT_SITE_TARGET); // a deleted custom profile
        });
        return () => {
            cancelled = true;
        };
    }, [id, id.startsWith(PROFILE_TARGET_PREFIX) ? profilesVersion : 0]);

    return (
        <SiteTargetContext.Provider value={{ id, plugin, setId }}>
            {children}
        </SiteTargetContext.Provider>
    );
}

export function useSiteTarget(): SiteTargetState {
    return useContext(SiteTargetContext);
}
