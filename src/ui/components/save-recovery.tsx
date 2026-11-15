import { useEffect, useRef, useState } from 'react';
import { Document } from '../../document';
import { Checkpoint, checkpointSource, MAX_CHECKPOINTS } from '../../storage/checkpoints';
import { deserialize, serialize } from '../../storage';
import { SaveController, SaveState } from '../../storage/save-controller';
import { showConfirm } from '../dialogs';
import { downloadFile, safeFileName } from '../../util/download';
import { workWordCount } from '../../util/word-count';
import './save-recovery.css';

const STATUS_LABELS: Record<SaveState['status'], [short: string, long: string]> = {
    unsaved: ['Not saved yet', 'Edit this work to keep it in this browser.'],
    pending: ['Edited', 'Your latest changes are about to be saved.'],
    saving: ['Saving…', 'Saving your latest changes.'],
    saved: ['Saved', 'Everything is saved in this browser.'],
    // unlike "Not saved yet", this one is a failure, so it must not read like it
    error: ['Couldn’t save', 'Your latest changes couldn’t be saved.'],
};

/**
 * The toolbar's save indicator for the work on screen. Autosave runs on its own; this only
 * reports it, and opens the work's version history.
 */
export function SaveStatus({
    state,
    memoryOnly,
    onOpenHistory,
}: {
    state: SaveState;
    memoryOnly: boolean;
    onOpenHistory: () => void;
}) {
    let [label, description] = STATUS_LABELS[state.status];
    if (state.status === 'saved' && memoryOnly) {
        label = 'Saved in memory';
        description = 'Browser storage is unavailable, so this work disappears when you close eo3.';
    }
    const problem = state.status === 'error' || !!state.recoveryError;
    return (
        <button
            className={'save-status is-' + state.status + (problem ? ' has-problem' : '')}
            title={`${description} Click for version history.`}
            onClick={onOpenHistory}
        >
            <span className="i-dot" aria-hidden="true" />
            <span role="status">{label}</span>
        </button>
    );
}

/** Shown above the editor only while the latest changes can't be saved. */
export function SaveErrorBanner({
    state,
    controller,
    work,
}: {
    state: SaveState;
    controller: SaveController;
    work: Document;
}) {
    const [busy, setBusy] = useState(false);
    if (!state.error && !state.recoveryError) return null;
    return (
        <div className="save-error-banner" role="alert">
            <span className="i-message">{state.error ?? state.recoveryError}</span>
            {state.error && (
                <>
                    <button
                        disabled={busy}
                        onClick={() => {
                            setBusy(true);
                            void controller
                                .flush()
                                .catch(() => {})
                                .finally(() => setBusy(false));
                        }}
                    >
                        Retry save
                    </button>
                    <button
                        onClick={() =>
                            downloadFile(serialize(work, 'toml'), safeFileName(work.title, 'toml'))
                        }
                    >
                        Download work
                    </button>
                </>
            )}
        </div>
    );
}

function formatWhen(at: string, now = new Date()): string {
    const date = new Date(at);
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const days = Math.round(
        (new Date(now.toDateString()).getTime() - new Date(date.toDateString()).getTime()) /
            86_400_000
    );
    if (days === 0) return `Today, ${time}`;
    if (days === 1) return `Yesterday, ${time}`;
    return `${date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    })}, ${time}`;
}

/** How much editing a version comes after; a tooltip, since what changed says more. */
function formatEditing(ms: number): string {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return 'Saved when version history started';
    if (minutes < 60) return `Saved after ${minutes} min of editing`;
    return `Saved after ${Math.floor(minutes / 60)} h ${minutes % 60} min of editing`;
}

/** What a writer would compare two versions by; null when the version can't be read. */
export type VersionSummary = { words: number; chapters: number } | null;

/** Versions never change, so each is summarized once per session, by checkpoint id. */
const summaries = new Map<string, VersionSummary>();

function summarize(source: string): VersionSummary {
    try {
        const work = deserialize(source);
        return { words: workWordCount(work), chapters: work.parts.length };
    } catch {
        return null;
    }
}

/**
 * Summarizes every version while the dialog is open, newest first (the top of the list), in
 * short slices so a long history doesn't freeze the page.
 */
function useVersionSummaries(
    open: boolean,
    recovery: SaveState['recovery']
): Map<string, VersionSummary> {
    const [, repaint] = useState(0);
    const { entries } = recovery;
    useEffect(() => {
        if (!open || entries.every((entry) => summaries.has(entry.id))) return;
        let cancelled = false;
        void (async () => {
            let sliceStart = Date.now();
            for (const { id } of [...entries].reverse()) {
                if (summaries.has(id)) continue;
                let summary: VersionSummary = null;
                try {
                    summary = summarize(checkpointSource(recovery, id));
                } catch {
                    // Damaged history: the version keeps its date, and opening it says why.
                }
                summaries.set(id, summary);
                if (Date.now() - sliceStart < 12) continue;
                repaint((n) => n + 1);
                await new Promise((resolve) => setTimeout(resolve));
                if (cancelled) return;
                sliceStart = Date.now();
            }
            if (!cancelled) repaint((n) => n + 1);
        })();
        return () => {
            cancelled = true;
        };
    }, [open, entries]);
    return summaries;
}

const count = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** What changed in a version since the one before it, e.g. "+85 words · 1 chapter added". */
export function describeVersion(
    version: VersionSummary | undefined,
    previous: VersionSummary | undefined
): string {
    if (version === undefined) return '';
    if (version === null) return 'can’t be read';
    if (!previous) return `${count(version.words, 'word')} · ${count(version.chapters, 'chapter')}`;
    const changes = [];
    const words = version.words - previous.words;
    if (words) changes.push(`${words > 0 ? '+' : '−'}${count(Math.abs(words), 'word')}`);
    const chapters = version.chapters - previous.chapters;
    if (chapters) {
        changes.push(
            `${count(Math.abs(chapters), 'chapter')} ${chapters > 0 ? 'added' : 'removed'}`
        );
    }
    return changes.join(' · ') || 'same word count';
}

/** A version's contents, read on demand; damaged history reports its error instead. */
function readVersion(
    entries: Checkpoint[],
    state: SaveState['recovery'],
    id: string
): { source: string; work: Document } | { error: string } {
    if (!entries.some((entry) => entry.id === id)) return { error: 'This version is gone.' };
    try {
        const source = checkpointSource(state, id);
        return { source, work: deserialize(source) };
    } catch (error) {
        return { error: String(error) };
    }
}

/**
 * The work's version history: turning it on, browsing saved versions, and restoring or
 * downloading one. Restoring is undoable and keeps the current draft as a version too.
 */
export function VersionHistory({
    open,
    onClose,
    state,
    controller,
    memoryOnly,
}: {
    open: boolean;
    onClose: () => void;
    state: SaveState;
    controller: SaveController;
    memoryOnly: boolean;
}) {
    const [selected, setSelected] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        if (open && !dialog.current?.open) {
            dialog.current?.showModal();
            setMessage('');
            void controller.refreshRecovery().catch((error) => setMessage(String(error)));
        }
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

    const { enabled, entries } = state.recovery;
    const versionSummaries = useVersionSummaries(open, state.recovery);
    // newest first, each with what changed since the version before it
    const newestFirst = entries
        .map((entry, i) => ({
            entry,
            change: describeVersion(
                versionSummaries.get(entry.id),
                i > 0 ? versionSummaries.get(entries[i - 1].id) : null
            ),
        }))
        .reverse();
    const version = selected ? readVersion(entries, state.recovery, selected) : null;

    return (
        <dialog
            ref={dialog}
            className="version-history"
            aria-labelledby="version-history-title"
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
        >
            <header className="i-heading">
                <h2 id="version-history-title">Version history</h2>
                <button className="i-close" onClick={onClose} aria-label="Close">
                    ×
                </button>
            </header>
            <p className="i-intro">
                eo3 saves your work in this browser as you type. Version history also keeps earlier
                versions, so you can go back if something goes wrong.
            </p>
            {memoryOnly && (
                <p className="i-warning">
                    Browser storage is unavailable, so this history disappears when you close the
                    page. Download your work to keep it.
                </p>
            )}
            <label className="i-toggle">
                <input
                    type="checkbox"
                    checked={enabled}
                    disabled={busy}
                    onChange={(event) => {
                        const on = event.target.checked;
                        void run(async () => {
                            await controller.setEnabled(on);
                            await controller.flush();
                        });
                    }}
                />
                <span>
                    <strong>Keep versions of this work</strong>
                    <small>
                        A version is saved for every minute you spend editing. The newest{' '}
                        {MAX_CHECKPOINTS} are kept. Turning this off keeps the versions you already
                        have.
                    </small>
                </span>
            </label>
            {state.recoveryError && <p className="i-warning">{state.recoveryError}</p>}
            {message && (
                <p className="i-message" role="status">
                    {message}
                </p>
            )}
            {entries.length ? (
                <div className="i-browser">
                    <ul className="i-versions" aria-label="Saved versions">
                        {newestFirst.map(({ entry, change }, i) => (
                            <li key={entry.id}>
                                <button
                                    aria-pressed={entry.id === selected}
                                    title={formatEditing(entry.activeMs)}
                                    onClick={() => setSelected(entry.id)}
                                >
                                    <span className="i-when">{formatWhen(entry.at)}</span>
                                    <span className="i-detail">
                                        {[i === 0 ? 'latest' : '', change]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="i-version">
                        {!version ? (
                            <p className="i-empty">Pick a version to see it.</p>
                        ) : 'error' in version ? (
                            <p className="i-warning">{version.error}</p>
                        ) : (
                            <>
                                <h3>{version.work.title || 'Untitled'}</h3>
                                <p>
                                    {plural(version.work.parts.length, 'chapter')} ·{' '}
                                    {plural(version.work.modules.length, 'module')}
                                    {version.work.author ? ` · by ${version.work.author}` : ''}
                                </p>
                                <div className="i-actions">
                                    <button
                                        className="is-primary"
                                        disabled={busy}
                                        onClick={() =>
                                            void run(async () => {
                                                await controller.restore(selected);
                                                await controller.flush();
                                                setMessage(
                                                    'Restored. Your previous draft was saved as a version too, and Undo brings it back.'
                                                );
                                            })
                                        }
                                    >
                                        Restore this version
                                    </button>
                                    <button
                                        disabled={busy}
                                        onClick={() =>
                                            downloadFile(
                                                version.source,
                                                safeFileName(version.work.title, 'toml')
                                            )
                                        }
                                    >
                                        Download
                                    </button>
                                </div>
                                <details>
                                    <summary>Show the saved file</summary>
                                    <pre>{version.source}</pre>
                                </details>
                            </>
                        )}
                    </div>
                </div>
            ) : (
                <p className="i-empty">
                    {enabled
                        ? 'No versions yet.'
                        : 'Turn on version history to start keeping versions.'}
                </p>
            )}
            {entries.length > 0 && (
                <footer className="i-footer">
                    <button
                        className="is-danger"
                        disabled={busy}
                        onClick={() =>
                            void run(async () => {
                                const yes = await showConfirm(
                                    'Delete every saved version of this work? Your current draft stays saved.',
                                    { confirmLabel: 'Delete versions', danger: true }
                                );
                                if (!yes) return;
                                await controller.clearHistory();
                                setSelected('');
                            })
                        }
                    >
                        Delete all versions…
                    </button>
                    <span className="i-hint">
                        Library backups in the sidebar include version history.
                    </span>
                </footer>
            )}
        </dialog>
    );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
