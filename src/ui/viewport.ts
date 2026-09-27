/**
 * Keeps the app sized to the part of the screen the on-screen keyboard leaves visible.
 *
 * Chrome for Android resizes the page itself (`interactive-widget=resizes-content` in
 * index.html), but iOS Safari only shrinks the visual viewport and pans it over the page, so
 * the fixed-position root is sized from `visualViewport` here. Sets on `<html>`:
 *
 * - `--P-viewport-top`, `--P-viewport-height`: the visible area (unset while pinch-zoomed)
 * - `--P-stable-height`: the visible height without the keyboard, so things sized from the
 *   screen height (like editors) don't collapse while typing
 * - `.is-keyboard-open`: probably showing an on-screen keyboard
 */
export function trackViewport() {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    let stable = { width: window.innerWidth, height: vv.height };

    const update = () => {
        if (Math.abs(vv.scale - 1) > 0.01) {
            // pinch-zoomed: the visual viewport is a zoomed-in window, not free space
            root.style.removeProperty('--P-viewport-top');
            root.style.removeProperty('--P-viewport-height');
            return;
        }

        // a keyboard takes a big bite out of the height without changing the width;
        // the threshold ignores the browser's address bar showing and hiding
        const keyboardOpen =
            coarsePointer.matches &&
            window.innerWidth === stable.width &&
            vv.height < stable.height * 0.8;
        if (!keyboardOpen) stable = { width: window.innerWidth, height: vv.height };

        root.style.setProperty('--P-viewport-top', vv.offsetTop + 'px');
        root.style.setProperty('--P-viewport-height', vv.height + 'px');
        root.style.setProperty('--P-stable-height', stable.height + 'px');
        root.classList.toggle('is-keyboard-open', keyboardOpen);
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    // not every resize reaches visualViewport (e.g. devtools device emulation)
    window.addEventListener('resize', update);
    update();
}
