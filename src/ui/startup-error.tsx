import { useState } from 'react';
import { IStorage } from '../storage';
import { createBackup } from '../storage/backup';
import { downloadFile } from '../util/download';
import { showAlert, showConfirm } from './dialogs';

/**
 * eo3 couldn't start. The works are usually still in the browser, so the way out is ordered by
 * how much it risks: reload, save a backup, and only then delete everything.
 */
export function StartupError({ error, storage }: { error: unknown; storage: IStorage }) {
    const [backup, setBackup] = useState<{ text: string; failed?: boolean } | null>(null);
    const [busy, setBusy] = useState(false);

    const downloadBackup = async () => {
        setBusy(true);
        setBackup(null);
        try {
            const data = await createBackup(storage);
            downloadFile(
                JSON.stringify(data),
                `eo3-backup-${new Date().toISOString().slice(0, 10)}.json`
            );
            const works = data.works.length;
            setBackup({
                text: works
                    ? `Backup downloaded with ${works} ${
                          works === 1 ? 'work' : 'works'
                      }. Check the file is in your downloads before you delete anything.`
                    : 'A backup was downloaded, but it has no works in it. Your works may not be readable right now.',
                failed: !works,
            });
        } catch (reason) {
            setBackup({
                text: `A backup couldn’t be made, so deleting eo3’s data would lose your works. (${String(
                    reason
                )})`,
                failed: true,
            });
        } finally {
            setBusy(false);
        }
    };

    const reset = async () => {
        const yes = await showConfirm(
            'Delete all of eo3’s data in this browser, including every saved work? This can’t be undone.',
            { confirmLabel: 'Delete everything', danger: true }
        );
        if (!yes) return;
        storage.close();
        const req = window.indexedDB.deleteDatabase('eo3_data');
        req.addEventListener('blocked', () => {
            showAlert('Waiting for another eo3 tab to stop using the data. Close it to continue.');
        });
        req.addEventListener('error', () => {
            showAlert(String(req.error), { title: 'Couldn’t delete the data' });
        });
        req.addEventListener('success', () => {
            window.location.reload();
        });
    };

    return (
        <div role="application" className="application-frame is-error">
            <div className="i-error">
                <h1>eo3 couldn’t start</h1>
                <p>
                    Something went wrong while opening your works. They are most likely still saved
                    in this browser.
                </p>
                <ol className="i-steps">
                    <li>
                        <strong>Reload the page.</strong> This often fixes it, especially if eo3 is
                        open in another tab.
                        <div>
                            <button onClick={() => window.location.reload()}>Reload</button>
                        </div>
                    </li>
                    <li>
                        <strong>Download a backup</strong> of everything eo3 can still read. You can
                        import it again later from the sidebar’s Backups section.
                        <div>
                            <button disabled={busy} onClick={() => void downloadBackup()}>
                                Download backup
                            </button>
                        </div>
                        {backup && (
                            <p
                                className={'i-backup' + (backup.failed ? ' is-failed' : '')}
                                role="status"
                            >
                                {backup.text}
                            </p>
                        )}
                    </li>
                    <li>
                        <strong>Last resort: start over.</strong> This deletes every work, version
                        and setting eo3 keeps in this browser.
                        <div>
                            <button className="is-danger" onClick={() => void reset()}>
                                Delete all eo3 data…
                            </button>
                        </div>
                    </li>
                </ol>
                <details>
                    <summary>Technical details</summary>
                    <pre>{String(error)}</pre>
                </details>
            </div>
        </div>
    );
}
