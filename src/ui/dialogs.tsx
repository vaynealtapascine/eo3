import { useEffect, useRef, useState } from 'react';
import './dialogs.css';

/**
 * In-app replacements for `alert()` and `confirm()`, which some browsers and embedded views
 * don't show (they return at once) and which can't be styled. Call `showAlert`/`showConfirm`
 * from anywhere; `<DialogHost />`, mounted once at the root, shows them one at a time.
 */

interface DialogRequest {
    message: string;
    title?: string;
    /** Set for a confirmation; an alert only has "OK". */
    confirmLabel?: string;
    danger?: boolean;
    resolve: (confirmed: boolean) => void;
}

const queue: DialogRequest[] = [];
const listeners = new Set<() => void>();

function request(dialog: Omit<DialogRequest, 'resolve'>): Promise<boolean> {
    return new Promise((resolve) => {
        queue.push({ ...dialog, resolve });
        for (const listener of listeners) listener();
    });
}

export function showAlert(message: string, options: { title?: string } = {}): Promise<void> {
    return request({ message, ...options }).then(() => undefined);
}

/** Resolves true if the author confirms, false if they cancel or dismiss the dialog. */
export function showConfirm(
    message: string,
    options: { title?: string; confirmLabel?: string; danger?: boolean } = {}
): Promise<boolean> {
    return request({ message, confirmLabel: 'OK', ...options });
}

export function DialogHost() {
    const [current, setCurrent] = useState<DialogRequest | null>(queue[0] ?? null);
    const dialog = useRef<HTMLDialogElement>(null);
    const confirmButton = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const update = () => setCurrent(queue[0] ?? null);
        listeners.add(update);
        update();
        return () => {
            listeners.delete(update);
        };
    }, []);

    useEffect(() => {
        const node = dialog.current;
        if (!node) return;
        if (current && !node.open) {
            node.showModal();
            confirmButton.current?.focus();
        } else if (!current && node.open) {
            node.close();
        }
    }, [current]);

    const finish = (confirmed: boolean) => {
        const done = queue.shift();
        done?.resolve(confirmed);
        setCurrent(queue[0] ?? null);
    };

    return (
        <dialog
            ref={dialog}
            className={'app-dialog' + (current?.danger ? ' is-danger' : '')}
            aria-labelledby="app-dialog-message"
            onCancel={(event) => {
                // Escape: dismiss this dialog rather than letting the browser close the element.
                event.preventDefault();
                finish(false);
            }}
        >
            {current && (
                <form
                    method="dialog"
                    onSubmit={(event) => {
                        event.preventDefault();
                        finish(true);
                    }}
                >
                    {current.title && <h2>{current.title}</h2>}
                    <p id="app-dialog-message">{current.message}</p>
                    <div className="i-buttons">
                        {current.confirmLabel && (
                            <button type="button" onClick={() => finish(false)}>
                                Cancel
                            </button>
                        )}
                        <button ref={confirmButton} type="submit" className="is-primary">
                            {current.confirmLabel ?? 'OK'}
                        </button>
                    </div>
                </form>
            )}
        </dialog>
    );
}
