import { IStorage } from './index';
import { importBackup, LibraryBackup, parseBackup } from './backup';

const MAX_MIGRATION_BYTES = 100 * 1024 * 1024;

const ALLOWED_SOURCES: Record<string, string> = {
    'dev.vayne.garden': 'https://dev.vayne.garden',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Returns the trusted source origin if the URL asks for a guided cross-origin library move. */
export function migrationSourceFromSearch(search: string): string | null {
    const key = new URLSearchParams(search).get('migrate');
    if (!key) return null;
    return ALLOWED_SOURCES[key] ?? null;
}

/** Human-readable summary of what a library backup contains. */
export function formatBackupSummary(backup: LibraryBackup): string {
    const parts: string[] = [];
    if (backup.works.length) parts.push(plural(backup.works.length, 'work'));
    if (backup.groups.length) parts.push(plural(backup.groups.length, 'group'));
    if (backup.styles?.length) parts.push(plural(backup.styles.length, 'custom style'));
    if (backup.profiles.length) parts.push(plural(backup.profiles.length, 'custom site'));
    return parts.length ? parts.join(', ') : 'no saved items';
}

function clearMigrationParam(win: Window) {
    try {
        const url = new URL(win.location.href);
        url.searchParams.delete('migrate');
        win.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {
        // Ignore history restrictions in unusual browsing contexts.
    }
}

export interface OriginMigrationOptions {
    storage: IStorage;
    onImported: (ids: string[]) => void;
    confirm: (message: string, title: string, confirmLabel: string) => Promise<boolean>;
    alert: (message: string, title: string) => Promise<void>;
    win?: Window;
}

/**
 * Coordinates a one-click library transfer from the previous origin (`dev.vayne.garden/eo3/`).
 * Only accepts payloads from the explicitly allowlisted opener origin and validates them through
 * `parseBackup` before asking the user to confirm importing as non-destructive copies.
 */
export function listenForOriginMigration({
    storage,
    onImported,
    confirm,
    alert,
    win = window,
}: OriginMigrationOptions): () => void {
    const expectedOrigin = migrationSourceFromSearch(win.location.search);
    if (!expectedOrigin || !win.opener) return () => {};

    const opener = win.opener as Window;
    let handled = false;

    const onMessage = (event: MessageEvent) => {
        if (handled) return;
        if (event.origin !== expectedOrigin) return;
        if (event.source !== opener) return;
        const data = event.data;
        if (!data || typeof data !== 'object' || data.type !== 'eo3-migrate-payload') return;
        if (typeof data.backup !== 'string') return;
        handled = true;

        void (async () => {
            try {
                if (data.backup.length > MAX_MIGRATION_BYTES) {
                    throw new Error('This library transfer is larger than 100 MiB.');
                }
                const backup = parseBackup(data.backup);
                const summary = formatBackupSummary(backup);
                const accepted = await confirm(
                    `Found ${summary} saved in this browser on dev.vayne.garden.\n\nImport them into eo3.dev? Everything is added as copies, so nothing already on eo3.dev is replaced.`,
                    'Move library from dev.vayne.garden?',
                    'Import library'
                );
                clearMigrationParam(win);
                if (!accepted) {
                    opener.postMessage({ type: 'eo3-migrate-cancelled' }, expectedOrigin);
                    return;
                }
                const ids = await importBackup(storage, data.backup);
                onImported(ids);
                opener.postMessage(
                    {
                        type: 'eo3-migrate-done',
                        imported: {
                            works: ids.length,
                            groups: backup.groups.length,
                            styles: backup.styles?.length ?? 0,
                            profiles: backup.profiles.length,
                        },
                    },
                    expectedOrigin
                );
                await alert(
                    `Imported ${summary} from dev.vayne.garden into eo3.dev.`,
                    'Library moved to eo3.dev'
                );
            } catch (error) {
                clearMigrationParam(win);
                opener.postMessage(
                    { type: 'eo3-migrate-error', message: String(error) },
                    expectedOrigin
                );
                await alert(
                    `Couldn’t import your library automatically (${String(
                        error
                    )}). Download a backup file on dev.vayne.garden/eo3/ and use Backups → import backup… here instead.`,
                    'Couldn’t move library'
                );
            }
        })();
    };

    win.addEventListener('message', onMessage);
    try {
        opener.postMessage({ type: 'eo3-migrate-ready' }, expectedOrigin);
    } catch {
        // Opener may have closed before ready handshake.
    }

    return () => {
        win.removeEventListener('message', onMessage);
    };
}
