import { createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loads = vi.hoisted(() => ({ text: vi.fn(), sass: vi.fn() }));
vi.mock('../../src/plugins', () => ({
    MODULES: {
        'source.text': {
            title: 'Text',
            description: 'Something you type.',
            category: 'writing',
            load: loads.text,
        },
        'source.shared-styles': {
            title: 'All chapters',
            description: 'Managed by eo3.',
            managed: true,
            load: vi.fn(),
        },
        'source.sass': {
            title: 'Sass',
            description: 'Outputs compiled CSS.',
            category: 'styles',
            load: loads.sass,
        },
        'transform.to-blob': { title: 'To blob', description: 'Converts input.', load: vi.fn() },
    },
}));
vi.mock('../../src/ui/dialogs', () => ({ showAlert: vi.fn(), showConfirm: vi.fn() }));
// like the real popover, a dialog around its contents
vi.mock('../../src/uikit/dir-popover', async () => {
    const { createElement } = await import('react');
    return {
        DirPopover: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
            open ? createElement('dialog', { open: true }, children) : null,
    };
});

import { ModulePicker } from '../../src/ui/components/module-picker';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

const render = (props: Partial<ModulePicker.Props> = {}) =>
    act(() =>
        root.render(
            createElement(ModulePicker, {
                open: true,
                onClose: vi.fn(),
                onPick: vi.fn(),
                onPickGroup: vi.fn(),
                ...props,
            })
        )
    );
const rowTitles = () =>
    [...container.querySelectorAll('.module-picker-item h4')].map((n) => n.textContent);
const addButton = (title: string) =>
    [...container.querySelectorAll<HTMLElement>('.module-picker-item')]
        .find((row) => row.querySelector('h4')?.textContent === title)!
        .querySelector<HTMLButtonElement>('.i-add-button')!;
const search = (text: string) => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => {
        input.value = text;
        Simulate.change(input);
    });
    return input;
};

describe('module picker', () => {
    it('lists module types by category, leaves managed ones out, and labels each row uniquely', () => {
        render();
        expect(rowTitles()).toEqual(['Groups and templates', 'Text', 'Sass', 'To blob']);
        expect([...container.querySelectorAll('.i-section')].map((n) => n.textContent)).toEqual([
            'Writing',
            'Styles',
            'Advanced',
        ]);

        const rows = [...container.querySelectorAll('.module-picker-item')];
        const ids = rows.map((row) => row.getAttribute('aria-labelledby'));
        expect(new Set(ids).size).toBe(rows.length);
        for (const row of rows) {
            const heading = document.getElementById(row.getAttribute('aria-labelledby')!);
            expect(row.contains(heading)).toBe(true);
        }
    });

    it('shows a failed load on its row and lets it be retried', async () => {
        const plugin = { id: 'source.text' };
        loads.text
            .mockRejectedValueOnce(new Error('Failed to fetch'))
            .mockResolvedValueOnce(plugin);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const onPick = vi.fn();
        render({ onPick });

        await act(async () => addButton('Text').click());
        expect(onPick).not.toHaveBeenCalled();
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(
            'couldn’t be loaded'
        );
        expect(addButton('Text').getAttribute('aria-label')).toBe('Try adding Text again');

        await act(async () => addButton('Text').click());
        expect(onPick).toHaveBeenCalledWith(plugin);
        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('marks the module being loaded and ignores other picks until it arrives', async () => {
        let finish!: (plugin: unknown) => void;
        loads.text.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
        const onPick = vi.fn();
        render({ onPick });

        await act(async () => addButton('Text').click());
        expect(addButton('Text').getAttribute('aria-busy')).toBe('true');
        expect(addButton('Sass').disabled).toBe(true);
        await act(async () => addButton('Text').click());
        expect(loads.text).toHaveBeenCalledTimes(1);

        await act(async () => finish({ id: 'source.text' }));
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(addButton('Sass').disabled).toBe(false);
    });

    it('searches module types and templates together, and Enter adds the first match', async () => {
        const onPickGroup = vi.fn();
        render({ onPickGroup });

        search('css');
        expect(rowTitles()).toEqual(['Sass']);

        search('letter');
        expect(rowTitles()).toContain('Letter');
        expect(rowTitles()).not.toContain('Text');
        expect(container.querySelector('.i-section')?.textContent).toBe('Templates');

        search('zzz');
        expect(rowTitles()).toEqual([]);
        expect(container.querySelector('[role="status"]')?.textContent).toContain('zzz');

        const input = search('chat log');
        await act(async () => Simulate.keyDown(input, { key: 'Enter' }));
        expect(onPickGroup).toHaveBeenCalledWith(expect.objectContaining({ title: 'Chat log' }));
    });

    it('adds from a click anywhere on a row, but not from the row’s own menu', async () => {
        const { saveLibraryGroup } = await import('../../src/storage/group-library');
        saveLibraryGroup({
            eo3: 'group',
            version: 1,
            title: 'My letter',
            modules: [{ plugin: 'source.text', data: null }],
        });
        loads.text.mockResolvedValueOnce({ id: 'source.text' });
        const onPick = vi.fn();
        const onPickGroup = vi.fn();
        render({ onPick, onPickGroup });

        const row = (title: string) =>
            [...container.querySelectorAll<HTMLElement>('.module-picker-item')].find(
                (node) => node.querySelector('h4')?.textContent === title
            )!;
        await act(async () => row('Text').querySelector('p')!.click());
        expect(onPick).toHaveBeenCalledTimes(1);

        await act(async () => row('Groups and templates').querySelector('p')!.click());
        await act(async () =>
            row('My letter').querySelector<HTMLElement>('.action-menu-button')!.click()
        );
        const menuItem = row('My letter').querySelector<HTMLElement>('[role="menuitem"]')!;
        await act(async () => menuItem.click());
        expect(onPickGroup).not.toHaveBeenCalled();
        await act(async () => row('My letter').querySelector('p')!.click());
        expect(onPickGroup).toHaveBeenCalledWith(expect.objectContaining({ title: 'My letter' }));
    });

    it('only searches module types when groups cannot be added', () => {
        render({ onPickGroup: undefined });
        expect(rowTitles()).toEqual(['Text', 'Sass', 'To blob']);
        search('letter');
        expect(rowTitles()).toEqual([]);
    });
});
