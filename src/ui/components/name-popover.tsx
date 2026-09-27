import { useEffect, useRef, useState } from 'react';
import { DirPopover } from '../../uikit/dir-popover';
import './name-popover.css';

/**
 * Asks for a name in a popover. Used instead of `window.prompt()`, which some browsers and
 * embedded views don't support (it throws), and which can't be styled.
 */
export function NamePopover({
    open,
    anchor,
    label,
    initial = '',
    submitLabel,
    onSubmit,
    onClose,
}: {
    open: boolean;
    anchor?: HTMLElement | null;
    label: string;
    initial?: string;
    submitLabel: string;
    onSubmit: (name: string) => void;
    onClose: () => void;
}) {
    const [name, setName] = useState(initial);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!open) return;
        setName(initial);
        // After the popover has opened and rendered its contents.
        const timer = setTimeout(() => input.current?.select(), 50);
        return () => clearTimeout(timer);
    }, [open, initial]);

    return (
        <DirPopover open={open} anchor={anchor} onClose={onClose}>
            <form
                className="name-popover"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!name.trim()) return;
                    onSubmit(name.trim());
                    onClose();
                }}
            >
                <label>
                    <span>{label}</span>
                    <input
                        ref={input}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        autoFocus
                    />
                </label>
                <div className="i-buttons">
                    <button type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="is-primary" disabled={!name.trim()}>
                        {submitLabel}
                    </button>
                </div>
            </form>
        </DirPopover>
    );
}
