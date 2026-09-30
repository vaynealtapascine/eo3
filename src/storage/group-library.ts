import { GroupFile, parseGroupFile } from './group-file';
import { createBrowserListStore } from './browser-list-store';

/**
 * "My groups": group files saved in this browser (localStorage) for reuse across works, in the
 * order the author arranges them. Like custom site profiles, they aren't part of any work;
 * export a group to a file to share it or move it to another browser.
 */
const STORAGE_KEY = 'eo3:group-library';

export interface LibraryGroup {
    id: string;
    file: GroupFile;
}

const store = createBrowserListStore<LibraryGroup>(
    STORAGE_KEY,
    (value) => {
        if (!value || typeof value !== 'object') return null;
        const entry = value as Record<string, unknown>;
        if (typeof entry.id !== 'string' || !entry.id) return null;
        return { id: entry.id, file: parseGroupFile(JSON.stringify(entry.file)) };
    },
    'My groups'
);

export const listLibraryGroups = store.list;

/** Adds a group at the end of the library. */
export function saveLibraryGroup(file: GroupFile) {
    store.write([...listLibraryGroups(), { id: Math.random().toString(36).slice(2), file }]);
}

export function removeLibraryGroup(id: string) {
    store.write(listLibraryGroups().filter((g) => g.id !== id));
}

/** Moves a group to `index` in the library's order. */
export function moveLibraryGroup(id: string, index: number) {
    const groups = listLibraryGroups();
    const from = groups.findIndex((g) => g.id === id);
    if (from === -1) return;
    const [moved] = groups.splice(from, 1);
    groups.splice(Math.max(0, Math.min(index, groups.length)), 0, moved);
    store.write(groups);
}

/** Calls `listener` after every change; returns an unsubscribe function. */
export const subscribeLibraryGroups = store.subscribe;

/** Used by complete-library backup import after validating every entry. */
export const replaceLibraryGroups = store.write;
