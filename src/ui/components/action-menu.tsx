import { useRef, useState } from 'react';
import { DirPopover } from '../../uikit/dir-popover';
import { showAlert } from '../dialogs';
import { useFocusWhenShown } from '../focus-when-shown';
import './action-menu.css';

export interface MenuAction {
    label: string;
    run: () => void;
    disabled?: boolean;
    danger?: boolean;
}

const enabledItems = (menu: HTMLElement | null) => [
    ...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
];

/**
 * A "⋯" button opening a list of actions; falsy entries are left out. Opening it focuses the
 * first action; arrow keys, Home and End move between actions, and Escape closes it.
 */
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
    const menu = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);

    useFocusWhenShown(open, () => enabledItems(menu.current)[0]);

    const onKeyDown = (event: React.KeyboardEvent) => {
        const items = enabledItems(menu.current);
        if (!items.length) return;
        const at = items.indexOf(window.document.activeElement as HTMLButtonElement);
        let next: number;
        if (event.key === 'ArrowDown') next = (at + 1) % items.length;
        else if (event.key === 'ArrowUp') next = (at <= 0 ? items.length : at) - 1;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else return;
        event.preventDefault();
        // a menu inside a list (the module picker) keeps its own keys
        event.stopPropagation();
        items[next].focus();
    };

    return (
        <>
            <button
                ref={button}
                className={'action-menu-button ' + className}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
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
                <div
                    ref={menu}
                    className="action-menu"
                    role="menu"
                    aria-label={label}
                    onKeyDown={onKeyDown}
                >
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
