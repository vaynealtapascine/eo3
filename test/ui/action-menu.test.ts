import { createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionMenu } from '../../src/ui/components/action-menu';

vi.mock('../../src/ui/dialogs', () => ({ showAlert: vi.fn() }));
vi.mock('../../src/uikit/dir-popover', () => ({
    DirPopover: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
        open ? children : null,
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('action menu keyboard use', () => {
    it('says whether it is open and moves between enabled actions with the arrow keys', async () => {
        act(() =>
            root.render(
                createElement(ActionMenu, {
                    label: 'Chapter 1 actions',
                    actions: [
                        { label: 'Move up', disabled: true, run: vi.fn() },
                        { label: 'Add styles', run: vi.fn() },
                        null,
                        { label: 'Move down', run: vi.fn() },
                        { label: 'Remove chapter', danger: true, run: vi.fn() },
                    ],
                })
            )
        );
        const trigger = container.querySelector<HTMLButtonElement>('.action-menu-button')!;
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        await act(async () => trigger.click());
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
        const focused = () => document.activeElement?.textContent;
        // opens on the first action that can be used
        expect(focused()).toBe('Add styles');

        const press = (key: string) => act(() => Simulate.keyDown(menu, { key }));
        press('ArrowDown');
        expect(focused()).toBe('Move down');
        press('ArrowDown');
        press('ArrowDown');
        expect(focused()).toBe('Add styles');
        press('ArrowUp');
        expect(focused()).toBe('Remove chapter');
        press('Home');
        expect(focused()).toBe('Add styles');
        press('End');
        expect(focused()).toBe('Remove chapter');
    });
});
