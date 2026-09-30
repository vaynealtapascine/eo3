import { useRef, useState } from 'react';
import { DirPopover } from '../../uikit/dir-popover';
import { showAlert } from '../dialogs';
import './action-menu.css';

export interface MenuAction {
    label: string;
    run: () => void;
    disabled?: boolean;
    danger?: boolean;
}

/** A "⋯" button opening a list of actions; falsy entries are left out. */
export function ActionMenu({
    label,
    actions,
    note,
    className = '',
}: {
    /** Accessible name, e.g. "Chapter 1 actions". */
    label: string;
    actions: (MenuAction | null | false | undefined)[];
    /** A line of context shown above the actions. */
    note?: string;
    className?: string;
}) {
    const button = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                ref={button}
                className={'action-menu-button ' + className}
                aria-label={label}
                aria-haspopup="menu"
                title={label}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    setOpen(true);
                }}
            >
                ⋯
            </button>
            <DirPopover anchor={button.current} open={open} onClose={() => setOpen(false)}>
                <div className="action-menu" role="menu" aria-label={label}>
                    {note && <p className="i-note">{note}</p>}
                    {actions.map(
                        (action) =>
                            action && (
                                <button
                                    key={action.label}
                                    role="menuitem"
                                    className={'i-item' + (action.danger ? ' is-danger' : '')}
                                    disabled={action.disabled}
                                    onClick={async () => {
                                        setOpen(false);
                                        try {
                                            await action.run();
                                        } catch (error) {
                                            showAlert(
                                                error instanceof Error
                                                    ? error.message
                                                    : String(error),
                                                {
                                                    title: 'Couldn’t complete the action',
                                                }
                                            );
                                        }
                                    }}
                                >
                                    {action.label}
                                </button>
                            )
                    )}
                </div>
            </DirPopover>
        </>
    );
}
