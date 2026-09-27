import { useEffect, useRef, useState } from 'react';
import { gitCommitHash } from 'eo3:config';
import { homepage } from '../../package.json';
import { Change, Changelog, fetchChangelog, githubRepo } from '../util/changelog';
import './update-notice.css';

const STORAGE_KEY = 'eo3:last-version';
const REPO = githubRepo(homepage);

/** A first visit lists the changes since this version ("ADD: EO3 logo.", 2026-07-18). */
const FIRST_VISIT_BASELINE = '3ce4778';

/**
 * The version this browser last acknowledged if it differs from this one; on a first visit,
 * the baseline, so newcomers can see what has changed recently too.
 */
function previousVersion(): string | null {
    try {
        const previous = window.localStorage.getItem(STORAGE_KEY) ?? FIRST_VISIT_BASELINE;
        return previous !== gitCommitHash ? previous : null;
    } catch {
        return null; // storage blocked: never nag
    }
}

function acknowledge() {
    try {
        window.localStorage.setItem(STORAGE_KEY, gitCommitHash);
    } catch {
        // storage blocked
    }
}

/**
 * A toast shown after eo3 updates (and on a first visit) until dismissed. "See changes" lists
 * the commits since the version this browser last acknowledged, fetched from GitHub.
 */
export function UpdateNotice() {
    const [previous] = useState(previousVersion);
    const [dismissed, setDismissed] = useState(false);
    const [showingChanges, setShowingChanges] = useState(false);
    const dismiss = () => {
        acknowledge();
        setDismissed(true);
    };

    if (!previous || dismissed) return null;
    return (
        <>
            <div className="update-toast" role="status">
                <span>eo3 has been updated.</span>
                <button onClick={() => setShowingChanges(true)}>See changes</button>
                <button className="i-dismiss" aria-label="Dismiss" onClick={dismiss}>
                    ×
                </button>
            </div>
            {showingChanges && (
                <ChangesDialog
                    from={previous}
                    onClose={() => {
                        setShowingChanges(false);
                        dismiss();
                    }}
                />
            )}
        </>
    );
}

function ChangesDialog({ from, onClose }: { from: string; onClose: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [log, setLog] = useState<Changelog | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        dialog.current?.showModal();
        if (!REPO) return setError('eo3 doesn’t know where its source lives.');
        fetchChangelog(REPO, from, gitCommitHash).then(setLog, (e) => setError(e.message));
    }, [from]);

    const compareUrl = REPO && `https://github.com/${REPO}/compare/${from}...${gitCommitHash}`;
    const empty = log && !log.features.length && !log.fixes.length && !log.other.length;

    return (
        <dialog
            ref={dialog}
            className="update-changes"
            aria-labelledby="update-changes-title"
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
        >
            <h2 id="update-changes-title">What’s new</h2>
            <p className="i-versions">
                From <code>{from}</code> to <code>{gitCommitHash}</code>
            </p>
            <div className="i-body">
                {!log && !error && <p>Loading changes…</p>}
                {error && (
                    <p>
                        Couldn’t load the changes: {error}{' '}
                        {compareUrl && (
                            <a href={compareUrl} target="_blank" rel="noreferrer">
                                See them on GitHub
                            </a>
                        )}
                    </p>
                )}
                {empty && <p>Nothing to list; this update only merged earlier changes.</p>}
                {log && (
                    <>
                        <ChangeList title="New" changes={log.features} />
                        <ChangeList title="Fixed" changes={log.fixes} />
                        <ChangeList title="Behind the scenes" changes={log.other} collapsed />
                    </>
                )}
            </div>
            <div className="i-buttons">
                {compareUrl && (
                    <a href={compareUrl} target="_blank" rel="noreferrer">
                        View on GitHub
                    </a>
                )}
                <button className="is-primary" onClick={onClose} autoFocus>
                    Close
                </button>
            </div>
        </dialog>
    );
}

function ChangeList({
    title,
    changes,
    collapsed = false,
}: {
    title: string;
    changes: Change[];
    collapsed?: boolean;
}) {
    if (!changes.length) return null;
    const list = (
        <ul>
            {changes.map((change) => (
                <li key={change.url || change.subject}>
                    {change.body ? (
                        <details>
                            <summary>{change.subject}</summary>
                            <p>{change.body}</p>
                        </details>
                    ) : (
                        change.subject
                    )}
                </li>
            ))}
        </ul>
    );
    return (
        <section>
            {collapsed ? (
                <details>
                    <summary>
                        <h3>
                            {title} ({changes.length})
                        </h3>
                    </summary>
                    {list}
                </details>
            ) : (
                <>
                    <h3>{title}</h3>
                    {list}
                </>
            )}
        </section>
    );
}
