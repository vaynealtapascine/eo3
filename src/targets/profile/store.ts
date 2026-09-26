import { TargetProfile, parseProfile } from './types';

/**
 * Custom target profiles describe sites, not stories, so they are kept app-wide in this
 * browser (localStorage) rather than in a document. The editor can export and import them as
 * JSON to share them or move them to another browser.
 */
const STORAGE_KEY = 'eo3:target-profiles';
export const PROFILE_TARGET_PREFIX = 'profile:';

const listeners = new Set<() => void>();

export function listProfiles(): TargetProfile[] {
    try {
        const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
        if (!Array.isArray(raw)) return [];
        return raw.map(parseProfile).filter((p): p is TargetProfile => typeof p !== 'string');
    } catch {
        return [];
    }
}

function write(profiles: TargetProfile[]) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch {
        // storage full or blocked: nothing else to fall back to
    }
    for (const listener of listeners) listener();
}

/** Adds the profile, or replaces the one with the same id. */
export function saveProfile(profile: TargetProfile) {
    const profiles = listProfiles().filter((p) => p.id !== profile.id);
    write([...profiles, profile]);
}

export function deleteProfile(id: string) {
    write(listProfiles().filter((p) => p.id !== id));
}

/** Calls `listener` after every change; returns an unsubscribe function. */
export function subscribeProfiles(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
