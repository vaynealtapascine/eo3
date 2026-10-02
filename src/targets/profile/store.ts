import { TargetProfile, parseProfile } from './types';
import { createBrowserListStore } from '../../storage/browser-list-store';

/**
 * Custom target profiles describe sites, not stories, so they are kept app-wide in this
 * browser (localStorage) rather than in a document. The editor can export and import them as
 * JSON to share them or move them to another browser.
 */
const STORAGE_KEY = 'eo3:target-profiles';
export const PROFILE_TARGET_PREFIX = 'profile:';

const store = createBrowserListStore<TargetProfile>(
    STORAGE_KEY,
    (value) => {
        const profile = parseProfile(value);
        return typeof profile === 'string' ? null : profile;
    },
    'custom sites'
);

export const listProfiles = store.list;

/** Adds the profile at the end, or replaces the one with the same id where it is. */
export function saveProfile(profile: TargetProfile) {
    const profiles = listProfiles();
    const index = profiles.findIndex((p) => p.id === profile.id);
    if (index === -1) profiles.push(profile);
    else profiles[index] = profile;
    store.write(profiles);
}

export function deleteProfile(id: string) {
    store.write(listProfiles().filter((p) => p.id !== id));
}

/** Calls `listener` after every change; returns an unsubscribe function. */
export const subscribeProfiles = store.subscribe;

/** Used by complete-library backup import after validating every entry. */
export const replaceProfiles = store.write;
