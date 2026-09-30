import { useEffect, useId, useRef, useState } from 'react';
import { Document } from '../../document';
import { checkpointSource } from '../../storage/checkpoints';
import { deserialize, serialize } from '../../storage';
import { SaveController, SaveState } from '../../storage/save-controller';
import { showConfirm } from '../dialogs';
import './save-recovery.css';

export function downloadText(source: string, filename: string) {
    const url = URL.createObjectURL(new Blob([source], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SaveRecovery({
    state,
    controller,
    work,
    memoryOnly,
}: {
    state: SaveState;
    controller: SaveController;
    work: Document;
    memoryOnly: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null);
    const revisionSelectId = useId();
    useEffect(() => {
        if (open && !dialog.current?.open) dialog.current?.showModal();
        if (!open && dialog.current?.open) dialog.current.close();
    }, [open]);

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
    const entries = state.recovery.entries;
    let source = '';
    let preview: Document | null = null;
    let previewError = '';
    if (selected) {
        try {
            source = checkpointSource(state.recovery, selected);
            preview = deserialize(source);
        } catch (error) {
            previewError = String(error);
        }
    }
    const status = {
        unsaved: 'Not saved in this browser yet',
        pending: 'Changes waiting to save…',
        saving: 'Saving…',
        saved: memoryOnly ? 'Saved in memory only' : 'Saved in this browser',
        error: 'Save failed',
    }[state.status];
    return (
        <div className="save-recovery">
            <span role="status" className={state.error ? 'save-error' : ''}>
                {status}
            </span>
            {state.error && (
                <>
                    <span className="save-error">{state.error}</span>
                    <button onClick={() => void run(controller.flush)} disabled={busy}>
                        Retry save
                    </button>
                    <button onClick={() => downloadText(serialize(work, 'json'), 'eo3-work.json')}>
                        Download work
                    </button>
                </>
            )}
            {state.recoveryError && (
                <span role="alert" className="save-error">
                    {state.recoveryError}
                </span>
            )}
            <button
                onClick={() => {
                    setOpen(true);
                    void run(controller.refreshRecovery);
                }}
            >
                Save history…
            </button>
            {!open && message && <span role="alert">{message}</span>}
            <dialog ref={dialog} className="recovery-dialog" onCancel={() => setOpen(false)}>
                <div className="recovery-heading">
                    <h2>Save history</h2>
                    <button onClick={() => setOpen(false)}>Close</button>
                </div>
                <p>
                    Autosave keeps your current draft. Optional checkpoints keep earlier versions.
                </p>
                {memoryOnly && (
                    <p className="save-error">
                        Browser storage is unavailable. This history disappears when you close the
                        page. Download a library backup to keep it.
                    </p>
                )}
                <label>
                    <input
                        type="checkbox"
                        checked={state.recovery.enabled}
                        disabled={busy}
                        onChange={(event) => {
                            const enabled = event.target.checked;
                            void run(async () => {
                                await controller.setEnabled(enabled);
                                await controller.flush();
                            });
                        }}
                    />{' '}
                    Keep checkpoints for this work
                </label>
                <p>
                    Changes are recorded every minute of active editing, with a full snapshot every
                    ten active minutes. The clock pauses in hidden or unfocused tabs and after a
                    minute without interaction. Disabling checkpoints keeps existing history.
                </p>
                <p>
                    History retains up to 120 revisions or about 20 MiB. The latest revision is
                    always retained, even if it is larger. A library backup includes the retained
                    history.
                </p>
                {state.recoveryError && <p role="alert">{state.recoveryError}</p>}
                {message && <p role="status">{message}</p>}
                {!entries.length ? (
                    <p>No checkpoints yet.</p>
                ) : (
                    <>
                        <div>
                            <label htmlFor={revisionSelectId}>Revision to inspect</label>
                            <select
                                id={revisionSelectId}
                                value={selected}
                                onChange={(event) => setSelected(event.target.value)}
                            >
                                <option value="">Choose a revision</option>
                                {[...entries].reverse().map((entry) => (
                                    <option key={entry.id} value={entry.id}>
                                        {new Date(entry.at).toLocaleString()} ·{' '}
                                        {entry.kind === 'snapshot' ? 'Full snapshot' : 'Changes'} ·{' '}
                                        {Math.floor(entry.activeMs / 60_000)} active min
                                    </option>
                                ))}
                            </select>
                        </div>
                        {previewError && <p role="alert">{previewError}</p>}
                        {preview && (
                            <div className="revision-preview">
                                <p>
                                    <strong>{preview.title || 'Untitled'}</strong> ·{' '}
                                    {preview.parts.length} chapters · {preview.modules.length}{' '}
                                    modules
                                </p>
                                <p>
                                    Restoring saves your current draft in history and adds the
                                    restored version as a new revision. You can also undo the
                                    restoration.
                                </p>
                                <details>
                                    <summary>Inspect saved source (not executed)</summary>
                                    <pre>{source}</pre>
                                </details>
                                <button
                                    disabled={busy}
                                    onClick={() => downloadText(source, 'eo3-revision.toml')}
                                >
                                    Download revision
                                </button>
                                <button
                                    disabled={busy}
                                    onClick={() =>
                                        void run(async () => {
                                            await controller.restore(selected);
                                            await controller.flush();
                                            setMessage(
                                                'Revision restored and saved. Your previous draft is retained in history.'
                                            );
                                        })
                                    }
                                >
                                    Restore as a new revision
                                </button>
                            </div>
                        )}
                        <button
                            disabled={busy}
                            onClick={() =>
                                void run(async () => {
                                    if (
                                        !(await showConfirm(
                                            'Remove this work’s checkpoint history? Your current draft stays saved.',
                                            { confirmLabel: 'Clear history', danger: true }
                                        ))
                                    )
                                        return;
                                    await controller.clearHistory();
                                    setSelected('');
                                })
                            }
                        >
                            Clear history…
                        </button>
                    </>
                )}
            </dialog>
        </div>
    );
}
