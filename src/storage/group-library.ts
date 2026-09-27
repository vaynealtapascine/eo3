import { GroupFile, parseGroupFile, stringifyGroupFile } from './group-file';

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

const listeners = new Set<() => void>();

export function listLibraryGroups(): LibraryGroup[] {
    try {
        const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
        if (!Array.isArray(raw)) return [];
        return raw.flatMap((entry) => {
            try {
                return [{ id: String(entry.id), file: parseGroupFile(JSON.stringify(entry.file)) }];
            } catch {
                return [];
            }
        });
    } catch {
        return [];
    }
}

function write(groups: LibraryGroup[]) {
    try {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(
                groups.map((g) => ({ id: g.id, file: JSON.parse(stringifyGroupFile(g.file)) }))
            )
        );
    } catch {
        // storage full or blocked: nothing else to fall back to
    }
    for (const listener of listeners) listener();
}

/** Adds a group at the end of the library. */
export function saveLibraryGroup(file: GroupFile) {
    write([...listLibraryGroups(), { id: Math.random().toString(36).slice(2), file }]);
}

export function removeLibraryGroup(id: string) {
    write(listLibraryGroups().filter((g) => g.id !== id));
}

/** Moves a group to `index` in the library's order. */
export function moveLibraryGroup(id: string, index: number) {
    const groups = listLibraryGroups();
    const from = groups.findIndex((g) => g.id === id);
    if (from === -1) return;
    const [moved] = groups.splice(from, 1);
    groups.splice(Math.max(0, Math.min(index, groups.length)), 0, moved);
    write(groups);
}

/** Calls `listener` after every change; returns an unsubscribe function. */
export function subscribeLibraryGroups(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
