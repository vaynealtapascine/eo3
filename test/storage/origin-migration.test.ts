import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Document } from '../../src/document';
import { createBackup } from '../../src/storage/backup';
import { MemoryStorage } from '../../src/storage';
import {
    formatBackupSummary,
    listenForOriginMigration,
    migrationSourceFromSearch,
} from '../../src/storage/origin-migration';

describe('origin migration from dev.vayne.garden', () => {
    beforeEach(() => {
        localStorage.clear();
        window.history.replaceState(null, '', '/?migrate=dev.vayne.garden');
    });

    it('only allows explicitly allowlisted migrate query values', () => {
        expect(migrationSourceFromSearch('?migrate=dev.vayne.garden')).toBe(
            'https://dev.vayne.garden'
        );
        expect(migrationSourceFromSearch('?migrate=evil.example')).toBeNull();
        expect(migrationSourceFromSearch('?example=ao3-letter.toml')).toBeNull();
    });

    it('formats non-empty backup summaries cleanly', () => {
        expect(
            formatBackupSummary({
                eo3: 'backup',
                version: 1,
                createdAt: new Date().toISOString(),
                works: [
                    {
                        id: 'w1',
                        title: 'Story',
                        data: '',
                        dateModified: new Date().toISOString(),
                        recovery: { enabled: false, activeMs: 0, snapshotAt: 0, entries: [] },
                    },
                ],
                groups: [],
                profiles: [],
            })
        ).toBe('1 work');
    });

    it('imports a verified payload from dev.vayne.garden and ignores untrusted origins', async () => {
        const sourceStorage = new MemoryStorage();
        const doc = new Document();
        doc.setTitle('Migrated Fic');
        await sourceStorage.saveDocument('doc-1', doc);
        const backupJson = JSON.stringify(await createBackup(sourceStorage));

        const targetStorage = new MemoryStorage();
        const postMessage = vi.fn();
        const fakeOpener = { postMessage } as unknown as Window;
        const listeners = new Set<(event: MessageEvent) => void>();
        const fakeWin = {
            location: window.location,
            history: window.history,
            opener: fakeOpener,
            addEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.add(fn),
            removeEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.delete(fn),
        } as unknown as Window;

        const onImported = vi.fn();
        const confirm = vi.fn(async () => true);
        const alert = vi.fn(async () => {});

        const cleanup = listenForOriginMigration({
            storage: targetStorage,
            onImported,
            confirm,
            alert,
            win: fakeWin,
        });

        expect(postMessage).toHaveBeenCalledWith(
            { type: 'eo3-migrate-ready' },
            'https://dev.vayne.garden'
        );

        // Untrusted origin is ignored.
        for (const fn of listeners) {
            fn(
                new MessageEvent('message', {
                    origin: 'https://evil.example',
                    source: fakeOpener,
                    data: { type: 'eo3-migrate-payload', backup: backupJson },
                })
            );
        }
        await Promise.resolve();
        expect(confirm).not.toHaveBeenCalled();

        // Trusted origin triggers confirmation and imports the work.
        for (const fn of listeners) {
            fn(
                new MessageEvent('message', {
                    origin: 'https://dev.vayne.garden',
                    source: fakeOpener,
                    data: { type: 'eo3-migrate-payload', backup: backupJson },
                })
            );
        }
        await vi.waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(alert).toHaveBeenCalledTimes(1);
        expect(await targetStorage.hasAnySavedDocuments()).toBe(true);
        expect(postMessage).toHaveBeenCalledWith(
            {
                type: 'eo3-migrate-done',
                imported: { works: 1, groups: 0, styles: 0, profiles: 0 },
            },
            'https://dev.vayne.garden'
        );
        expect(window.location.search).toBe('');

        cleanup();
    });
});
