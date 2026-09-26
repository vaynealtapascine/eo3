import { PartPosting } from '../../../targets/types';
import './posted-status.css';

/**
 * "Mark as posted" for the part on screen. Marking is explicit; copying a part without marking
 * it, or changing a posted part, shows a reminder.
 */
export function PostedStatus({ posting, partName }: { posting: PartPosting; partName: string }) {
    const { posted, copiedUnmarked, changedSincePosted } = posting;

    if (posted) {
        return (
            <span className="posted-status is-posted">
                {changedSincePosted ? (
                    <span className="i-note is-warning">
                        {partName} changed since you marked it posted on {posted.at}. Post the new
                        version, then mark it again.
                    </span>
                ) : (
                    <span className="i-note">Posted {posted.at}</span>
                )}
                {changedSincePosted && (
                    <button className="button-appearance" onClick={posting.markPosted}>
                        mark as posted again
                    </button>
                )}
                <button className="i-link" onClick={posting.unmarkPosted}>
                    unmark
                </button>
            </span>
        );
    }

    return (
        <span className="posted-status">
            {copiedUnmarked && (
                <span className="i-note is-warning">
                    You copied {partName} but haven’t marked it as posted. Mark it once it’s up, so
                    its styles are kept in the Work Skin.
                </span>
            )}
            <button className="button-appearance" onClick={posting.markPosted}>
                mark as posted
            </button>
        </span>
    );
}
