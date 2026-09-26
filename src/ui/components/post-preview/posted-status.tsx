import { PartPosting } from '../../../targets/types';
import { useState } from 'react';
import './posted-status.css';

/**
 * "Mark as posted" for the part on screen. Marking is explicit; copying a part without marking
 * it, or changing a posted part, shows a reminder.
 */
export function PostedStatus({ posting, partName }: { posting: PartPosting; partName: string }) {
    const { posted, copiedUnmarked, changedSincePosted, skinDiff, unusedStyles } = posting;
    const [selectedProtected, setSelectedProtected] = useState<string[]>([]);
    const skinChanged = !!skinDiff && (skinDiff.added > 0 || skinDiff.removed > 0);
    const skinDetails = (
        <>
            {skinChanged && (
                <span className="i-note is-warning">
                    Work Skin changes: {skinDiff.added} styles added, {skinDiff.removed} removed.
                    Check them before copying it.
                </span>
            )}
            {!!unusedStyles?.length && (
                <details className="skin-cleanup">
                    <summary>{unusedStyles.length} recorded styles no posted part uses</summary>
                    <ul>
                        {unusedStyles.map(({ className, css }) => (
                            <li key={className}>
                                <code>{className}</code>
                                <pre>{css}</pre>
                            </li>
                        ))}
                    </ul>
                    <button className="button-appearance" onClick={posting.cleanupUnusedStyles}>
                        clean up unused styles
                    </button>
                </details>
            )}
            {!!posting.protectedStyles?.length && (
                <details className="skin-cleanup">
                    <summary>
                        {posting.protectedStyles.length} styles protected for imported chapters
                    </summary>
                    <p>
                        These may be used by chapters you have not imported. Select rules to remove
                        them from the imported skin and release their protection.
                    </p>
                    <ul>
                        {posting.protectedStyles.map(({ className, css }) => (
                            <li key={className}>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={selectedProtected.includes(className)}
                                        onChange={(event) =>
                                            setSelectedProtected((names) =>
                                                event.target.checked
                                                    ? [...names, className]
                                                    : names.filter((name) => name !== className)
                                            )
                                        }
                                    />{' '}
                                    <code>{className}</code>
                                </label>
                                <pre>{css}</pre>
                            </li>
                        ))}
                    </ul>
                    <button
                        className="button-appearance"
                        disabled={!selectedProtected.length}
                        onClick={() => {
                            posting.pruneProtectedStyles?.(selectedProtected);
                            setSelectedProtected([]);
                        }}
                    >
                        remove selected styles
                    </button>
                </details>
            )}
        </>
    );

    if (posted) {
        return (
            <div className="posted-status is-posted">
                {changedSincePosted ? (
                    <span className="i-note is-warning">
                        {partName} changed since you marked it posted on {posted.at}. Post the new
                        version, then mark it again.
                    </span>
                ) : (
                    <span className="i-note">Posted {posted.at}</span>
                )}
                {(changedSincePosted || skinChanged) && (
                    <button className="button-appearance" onClick={posting.markPosted}>
                        mark as posted again
                    </button>
                )}
                {skinDetails}
                <button className="i-link" onClick={posting.unmarkPosted}>
                    unmark
                </button>
            </div>
        );
    }

    return (
        <div className="posted-status">
            {copiedUnmarked && (
                <span className="i-note is-warning">
                    You copied {partName} but haven’t marked it as posted. Mark it once it’s up, so
                    eo3 can tell you when it changes and keep the styles it uses.
                </span>
            )}
            <button className="button-appearance" onClick={posting.markPosted}>
                mark as posted
            </button>
            {skinDetails}
        </div>
    );
}
