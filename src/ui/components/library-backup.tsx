import { useContext, useRef, useState } from 'react';
import { Document } from '../../document';
import { StorageContext } from '../../storage-context';
import { createBackup, importBackup, LibraryBackup, parseBackup } from '../../storage/backup';
import { downloadText } from './save-recovery';

export function LibraryBackupControls({
    liveWorks,
    onImported,
}: {
    liveWorks(): Map<string, Document>;
    onImported(ids: string[]): void;
}) {
    const storage = useContext(StorageContext);
    const input = useRef<HTMLInputElement>(null);
    const [source, setSource] = useState('');
    const [preview, setPreview] = useState<LibraryBackup | null>(null);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setMessage('');
        try {
            await action();
        } catch (error) {
            setMessage(String(error));
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="library-backup" aria-label="Library backup">
            <h2>Backup and recovery</h2>
            <p>
                Keep a downloadable copy of all works, checkpoint history, My groups, and custom
                sites. Open drafts are included with their latest edits.
            </p>
            <button
                disabled={busy}
                onClick={() =>
                    void run(async () => {
                        const backup = await createBackup(storage, liveWorks());
                        downloadText(
                            JSON.stringify(backup),
                            `eo3-library-${new Date().toISOString().slice(0, 10)}.json`
                        );
                        setMessage('Library backup downloaded.');
                    })
                }
            >
                Download library backup
            </button>
            <button disabled={busy} onClick={() => input.current?.click()}>
                Choose backup to import…
            </button>
            <input
                ref={input}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    void run(async () => {
                        setPreview(null);
                        setSource('');
                        if (file.size > 100 * 1024 * 1024)
                            throw new Error('This backup exceeds the 100 MiB import limit.');
                        const text = await file.text();
                        const backup = parseBackup(text);
                        setSource(text);
                        setPreview(backup);
                    });
                }}
            />
            {preview && (
                <div>
                    <p>
                        {preview.works.length} works, {preview.groups.length} groups,{' '}
                        {preview.profiles.length} custom sites. Works import as separate copies;
                        existing works and history are preserved. Conflicting custom sites are kept
                        separately.
                    </p>
                    <button
                        disabled={busy}
                        onClick={() =>
                            void run(async () => {
                                const ids = await importBackup(storage, source);
                                onImported(ids);
                                setPreview(null);
                                setSource('');
                                setMessage(
                                    `Imported ${ids.length} work copies and their libraries.`
                                );
                            })
                        }
                    >
                        Import backup as copies
                    </button>
                    <button
                        disabled={busy}
                        onClick={() => {
                            setPreview(null);
                            setSource('');
                        }}
                    >
                        Cancel import
                    </button>
                </div>
            )}
            {navigator.storage?.persist && (
                <button
                    disabled={busy}
                    onClick={() =>
                        void run(async () => {
                            const persisted = await navigator.storage.persist();
                            setMessage(
                                persisted
                                    ? 'The browser granted persistent storage. Keep downloadable backups too.'
                                    : 'The browser did not grant persistent storage. Your downloadable backups remain available.'
                            );
                        })
                    }
                >
                    Ask browser to keep local data
                </button>
            )}
            {message && <p role="status">{message}</p>}
        </section>
    );
}
