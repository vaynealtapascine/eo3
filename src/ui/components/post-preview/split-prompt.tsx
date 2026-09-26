import { useState } from 'react';
import { PartSizing } from '../../../targets/types';

/** Offered once a part reaches this share of the site's limit. */
const SPLIT_OFFER_AT = 0.95;

/** "Chapter 3 is 96% of AO3's limit. Split it here?" once a part nears the site's size limit. */
export function SplitPrompt({
    sizing,
    partName,
    siteName,
}: {
    sizing: PartSizing;
    partName: string;
    siteName: string;
}) {
    const [problem, setProblem] = useState<string | null>(null);
    if (!sizing.max || sizing.size < sizing.max * SPLIT_OFFER_AT) return null;

    const percent = Math.round((sizing.size / sizing.max) * 100);
    return (
        <span className="posted-status split-prompt">
            <span className="i-note is-warning">
                {partName} is {percent}% of {siteName}’s size limit.
            </span>
            <button className="button-appearance" onClick={() => setProblem(sizing.split())}>
                split it here
            </button>
            {problem && <span className="i-note">{problem}</span>}
        </span>
    );
}
