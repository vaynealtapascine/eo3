import { useRef, useState } from 'react';
import { DirPopover } from '../../../uikit/dir-popover';
import { Button } from '../../../uikit/button';
import { SiteTargetExportAction, SiteTargetExportOutput } from '../../../targets/types';
import { useFocusWhenShown } from '../../focus-when-shown';
import './copy-to-clipboard-button.css';

export function CopyToClipboardButton({
    action,
    exportOutput,
    disabled,
    onCopied,
}: {
    action: SiteTargetExportAction;
    exportOutput: SiteTargetExportOutput;
    disabled?: boolean;
    onCopied?: (outputId: string) => void;
}) {
    const [copied, setCopied] = useState(false);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [warningsOpen, setWarningsOpen] = useState(false);
    /** The text to copy by hand, shown when the browser refuses to copy it for us. */
    const [manual, setManual] = useState<string | null>(null);
    const manualText = useRef<HTMLTextAreaElement>(null);
    // focusing it selects everything (see onFocus), so Ctrl+C works straight away
    useFocusWhenShown(manual !== null, () => manualText.current);

    const getData = () => exportOutput.get(action.outputId) ?? '';

    const didCopy = () => {
        onCopied?.(action.outputId);
        setCopied(true);
        setTimeout(() => {
            setCopied(false);
        }, 1000);
    };

    const copy = async () => {
        const data = getData();
        try {
            // Rejects (or `clipboard` is missing) when the page isn't allowed to copy: an
            // embedded view, an insecure origin, a denied permission.
            await navigator.clipboard.writeText(data);
        } catch {
            setManual(data);
            return;
        }
        // Only now: copying is what starts the "mark as posted" reminders.
        didCopy();
    };

    const tryCopy = () => {
        const data = getData();
        const warnings = action.getWarnings ? action.getWarnings(data) : [];
        setWarnings(warnings);
        if (warnings.length) {
            setWarningsOpen(true);
        } else {
            void copy();
        }
    };

    const button = useRef<HTMLButtonElement>(null);

    return (
        <>
            <button
                ref={button}
                disabled={disabled}
                className={'button-appearance copy-to-clipboard' + (copied ? ' did-copy' : '')}
                onClick={tryCopy}
            >
                {action.label}
            </button>
            <DirPopover
                anchor={button.current}
                open={warningsOpen}
                onClose={() => setWarningsOpen(false)}
            >
                <div className="copy-to-clipboard-warnings">
                    <ul className="i-warnings">
                        {warnings.map((warning, i) => (
                            <li key={i}>{warning}</li>
                        ))}
                    </ul>
                    <div className="i-buttons">
                        <Button
                            primary
                            run={() => {
                                setWarningsOpen(false);
                            }}
                        >
                            cancel
                        </Button>
                        <Button
                            run={() => {
                                setWarningsOpen(false);
                                return copy();
                            }}
                        >
                            copy anyway
                        </Button>
                    </div>
                </div>
            </DirPopover>
            <DirPopover
                anchor={button.current}
                open={manual !== null}
                onClose={() => setManual(null)}
            >
                <div className="copy-to-clipboard-manual" role="alert">
                    <p className="i-explanation">
                        Your browser didn’t let eo3 copy this for you. Select the text below and
                        copy it yourself.
                    </p>
                    <textarea
                        ref={manualText}
                        className="i-text"
                        aria-label={`Text for “${action.label}”`}
                        readOnly
                        value={manual ?? ''}
                        onFocus={(event) => event.target.select()}
                        // Copying by hand counts, so the posting reminders still appear.
                        onCopy={() => onCopied?.(action.outputId)}
                    />
                    <div className="i-buttons">
                        <Button
                            run={() => {
                                manualText.current?.focus();
                                manualText.current?.select();
                            }}
                        >
                            select all
                        </Button>
                        <Button primary run={() => setManual(null)}>
                            done
                        </Button>
                    </div>
                </div>
            </DirPopover>
        </>
    );
}
