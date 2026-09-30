/** Small browser libraries share persistence and notifications, but own their file formats. */
export function createBrowserListStore<T>(
    key: string,
    parseEntry: (value: unknown) => T | null,
    label: string
) {
    const listeners = new Set<() => void>();
    return {
        list(): T[] {
            try {
                const raw: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
                if (!Array.isArray(raw)) return [];
                return raw.flatMap((entry) => {
                    try {
                        const value = parseEntry(entry);
                        return value === null ? [] : [value];
                    } catch {
                        return [];
                    }
                });
            } catch {
                return [];
            }
        },
        /** Notify only after a successful write; callers must display failures to the author. */
        write(entries: T[]): void {
            try {
                window.localStorage.setItem(key, JSON.stringify(entries));
            } catch {
                throw new Error(
                    `Couldn’t save ${label} in this browser. Storage may be full or blocked. Export a file to keep a copy.`
                );
            }
            for (const listener of listeners) listener();
        },
        subscribe(listener: () => void): () => void {
            listeners.add(listener);
            const onStorage = (event: StorageEvent) => {
                if (
                    event.storageArea === window.localStorage &&
                    (event.key === key || event.key === null)
                ) {
                    listener();
                }
            };
            window.addEventListener('storage', onStorage);
            return () => {
                listeners.delete(listener);
                window.removeEventListener('storage', onStorage);
            };
        },
    };
}
