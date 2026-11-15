import { useEffect } from 'react';

/**
 * Moves focus to `target()` once a popover or dialog that just opened is actually on screen.
 * `DirPopover` opens its `<dialog>` a frame or two after `open` turns true and mounts its
 * contents after that, so focusing in the same tick does nothing.
 */
export function useFocusWhenShown(open: boolean, target: () => HTMLElement | null | undefined) {
    useEffect(() => {
        if (!open) return;
        let frame = 0;
        let tries = 0;
        const focus = () => {
            const node = target();
            const dialog = node?.closest('dialog');
            if (node && (!dialog || dialog.open)) {
                node.focus();
            } else if (tries++ < 30) {
                frame = requestAnimationFrame(focus);
            }
        };
        focus();
        return () => cancelAnimationFrame(frame);
    }, [open]);
}

/** True on touch-first devices, where focusing a text field brings up the on-screen keyboard. */
export function isCoarsePointer(): boolean {
    return (
        typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    );
}
