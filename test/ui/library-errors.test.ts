import { createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionMenu } from '../../src/ui/components/action-menu';
import { ProfileEditor } from '../../src/ui/components/profile-editor';
import { Document } from '../../src/document';
import { listProfiles, saveProfile } from '../../src/targets/profile/store';
import { newProfile } from '../../src/targets/profile/types';
import { showAlert } from '../../src/ui/dialogs';

vi.mock('../../src/ui/dialogs', () => ({
    showAlert: vi.fn(),
    showConfirm: vi.fn(async () => true),
}));
vi.mock('../../src/uikit/dir-popover', () => ({
    DirPopover: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
        open ? children : null,
}));

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
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});
const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === label
    );
    expect(button).toBeDefined();
    await act(async () => {
        button!.click();
    });
};
const blockWrites = () =>
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage blocked');
    });

describe('library failures in the UI', () => {
    it.each([false, true])(
        'shows failed menu actions, including async rejections (%s)',
        async (asyncFailure) => {
            const error = new Error('Couldn’t save My groups');
            const run = () => {
                if (asyncFailure) return Promise.reject(error);
                throw error;
            };
            act(() =>
                root.render(
                    createElement(ActionMenu, {
                        label: 'Actions',
                        actions: [{ label: 'Save group', run }],
                    })
                )
            );
            await click('⋯');
            await click('Save group');
            expect(showAlert).toHaveBeenCalledWith(error.message, {
                title: 'Couldn’t complete the action',
            });
            expect(container.querySelector('[role="menu"]')).toBeNull();
        }
    );

    it('keeps an edited profile open and does not switch targets when save fails', async () => {
        saveProfile(newProfile('site'));
        const onUse = vi.fn();
        act(() =>
            root.render(
                createElement(ProfileEditor, {
                    open: false,
                    document: new Document(),
                    onClose: vi.fn(),
                    onUse,
                })
            )
        );
        await click('My site');
        blockWrites();
        await click('save and preview with it');
        expect(onUse).not.toHaveBeenCalled();
        expect(container.querySelector('[role="status"]')?.textContent).toContain(
            'Storage may be full or blocked'
        );
        expect(container.querySelector('form')).not.toBeNull();
        expect(listProfiles()).toHaveLength(1);
        await click('delete');
        expect(container.querySelector('form')).not.toBeNull();
        expect(listProfiles()).toHaveLength(1);
    });

    it('shows import failures before a profile is selected and preserves the pasted JSON', async () => {
        act(() =>
            root.render(
                createElement(ProfileEditor, {
                    open: false,
                    document: new Document(),
                    onClose: vi.fn(),
                    onUse: vi.fn(),
                })
            )
        );
        const textarea = container.querySelector('textarea')!;
        const input = JSON.stringify(newProfile('imported'));
        act(() => {
            textarea.value = input;
            Simulate.change(textarea);
        });
        blockWrites();
        await click('import');
        expect(container.querySelector('[role="status"]')?.textContent).toContain(
            'Storage may be full or blocked'
        );
        expect(textarea.value).toBe(input);
        expect(listProfiles()).toEqual([]);
    });
});
