import { useContext, useRef, useState } from 'react';
import { Document } from '../../document';
import { StorageContext } from '../../storage-context';
import { createBackup, importBackup, LibraryBackup, parseBackup } from '../../storage/backup';
import { Button } from '../../uikit/button';
import { downloadFile } from '../../util/download';

const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Sidebar section: download everything eo3 keeps in this browser as one file, or bring such a
 * file back in as copies. Shown with the sidebar's other sections.
 */
export function LibraryBackupControls({
    liveWorks,
    onImported,
}: {
    liveWorks(): Map<string, Document>;
    onImported(ids: string[]): void;
}) {
    const storage = useContext(StorageContext);
    const input = useRef<HTMLInputElement>(null);
    const [pending, setPending] = useState<{ source: string; backup: LibraryBackup } | null>(null);
    const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

    const run = async (action: () => Promise<void>) => {
        setMessage(null);
        try {
            await action();
        } catch (error) {
            setMessage({ text: String(error), error: true });
        }
    };

    return (
        <div className="i-section i-backup" role="group" aria-label="Backups">
            <h2 className="i-title">Backups</h2>
            <div className="i-card">
                <p>
                    Download one file with all your works, their version history, My groups and
                    custom sites. Keep it somewhere safe: browser data can be cleared.
                </p>
                <div className="i-buttons">
                    <Button
                        run={() =>
                            run(async () => {
                                const backup = await createBackup(storage, liveWorks());
                                downloadFile(
                                    JSON.stringify(backup),
                                    `eo3-backup-${new Date().toISOString().slice(0, 10)}.json`
                                );
                                setMessage({ text: 'Backup downloaded.' });
                            })
                        }
                    >
                        download backup
                    </Button>
                    <Button run={() => input.current?.click()}>restore…</Button>
                </div>
                <input
                    ref={input}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        setPending(null);
                        void run(async () => {
                            if (file.size > MAX_IMPORT_BYTES)
                                throw new Error('This backup is larger than 100 MiB.');
                            const source = await file.text();
                            setPending({ source, backup: parseBackup(source) });
                        });
                    }}
                />
                {pending && (
                    <div className="i-confirm">
                        <p>
                            This backup has {plural(pending.backup.works.length, 'work')},{' '}
                            {plural(pending.backup.groups.length, 'group')} and{' '}
                            {plural(pending.backup.profiles.length, 'custom site')}. They’re added
                            as copies; nothing you have now is replaced.
                        </p>
                        <div className="i-buttons">
                            <Button
                                primary
                                run={() =>
                                    run(async () => {
                                        const ids = await importBackup(storage, pending.source);
                                        setPending(null);
                                        onImported(ids);
                                        setMessage({
                                            text: `Restored ${plural(ids.length, 'work')}.`,
                                        });
                                    })
                                }
                            >
                                add copies
                            </Button>
                            <Button run={() => setPending(null)}>cancel</Button>
                        </div>
                    </div>
                )}
                {navigator.storage?.persist && (
                    <details className="i-persist">
                        <summary>Ask the browser to keep eo3’s data</summary>
                        <p>
                            Browsers may clear site data when space runs low. You can ask yours not
                            to; it decides on its own.
                        </p>
                        <Button
                            run={() =>
                                run(async () => {
                                    const granted = await navigator.storage.persist();
                                    setMessage({
                                        text: granted
                                            ? 'The browser will keep eo3’s data. Keep downloading backups anyway.'
                                            : 'The browser said no. Download backups to be safe.',
                                    });
                                })
                            }
                        >
                            ask
                        </Button>
                    </details>
                )}
                {message && (
                    <p className={'i-message' + (message.error ? ' is-error' : '')} role="status">
                        {message.text}
                    </p>
                )}
            </div>
        </div>
    );
}
