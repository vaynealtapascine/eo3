import { useRef, useState } from 'react';
import { DirPopover } from '../../../uikit/dir-popover';
import { Button } from '../../../uikit/button';
import { SiteTargetExportAction, SiteTargetExportOutput } from '../../../targets/types';

export function CopyToClipboardButton({
    action,
    exportOutput,
    disabled,
}: {
    action: SiteTargetExportAction;
    exportOutput: SiteTargetExportOutput;
    disabled?: boolean;
}) {
    const [copied, setCopied] = useState(false);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [warningsOpen, setWarningsOpen] = useState(false);

    const getData = () => exportOutput.get(action.outputId) ?? '';

    const copy = () => {
        try {
            navigator.clipboard.writeText(getData());
            setCopied(true);
            setTimeout(() => {
                setCopied(false);
            }, 1000);
        } catch (err) {
            alert('Could not copy to clipboard\n\n' + err);
        }
    };

    const tryCopy = () => {
        const data = getData();
        const warnings = action.getWarnings ? action.getWarnings(data) : [];
        setWarnings(warnings);
        if (warnings.length) {
            setWarningsOpen(true);
        } else {
            copy();
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
                                copy();
                                setWarningsOpen(false);
                            }}
                        >
                            copy anyway
                        </Button>
                    </div>
                </div>
            </DirPopover>
        </>
    );
}
