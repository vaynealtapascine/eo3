import { createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Document } from '../../src/document';
import { MemoryStorage } from '../../src/storage';
import { SaveController, SaveState } from '../../src/storage/save-controller';
import { SaveRecovery } from '../../src/ui/components/save-recovery';

vi.mock('../../src/ui/dialogs', () => ({ showConfirm: vi.fn(async () => true) }));
let container: HTMLDivElement;
let root: Root;
let writer: SaveController | undefined;
beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
        configurable: true,
        value: function (this: HTMLDialogElement) {
            this.open = true;
        },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
        configurable: true,
        value: function (this: HTMLDialogElement) {
            this.open = false;
        },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    act(() => {
        writer?.dispose();
        root.unmount();
    });
    writer = undefined;
    container.remove();
    await Promise.resolve();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLDialogElement.prototype as any).showModal;
    delete (HTMLDialogElement.prototype as any).close;
});

async function setup(memoryOnly = false) {
    const work = new Document();
    work.setTitle('Original title');
    const storage = new MemoryStorage();
    await storage.saveDocument('work', work);
    const render = (state: SaveState) =>
        root.render(
            createElement(SaveRecovery, {
                state,
                controller: writer!,
                work,
                memoryOnly,
            })
        );
    writer = new SaveController(storage, 'work', work, {
        persisted: true,
        isActive: () => true,
        onState: render,
    });
    await act(async () => {
        await writer!.ready;
        render(writer!.state);
    });
    return { work, storage };
}
async function click(label: string) {
    const button = [...container.querySelectorAll('button')].find(
        (node) => node.textContent === label
    );
    expect(button).toBeDefined();
    await act(async () => {
        button!.click();
    });
}

describe('save recovery controls', () => {
    it('shows failure, preserves editing and recovers with an explicit retry', async () => {
        const { work, storage } = await setup();
        const original = storage.saveDocument.bind(storage);
        const save = vi.spyOn(storage, 'saveDocument').mockRejectedValue(new Error('Storage full'));
        await act(async () => {
            work.setTitle('Latest writing');
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(container.textContent).toContain('Save failed');
        expect(container.textContent).toContain('Storage full');
        expect(container.textContent).toContain('Download work');
        save.mockImplementation(original);
        await click('Retry save');
        expect(container.textContent).toContain('Saved in this browser');
        expect((await storage.getDocument('work'))?.title).toBe('Latest writing');
    });

    it('opts in, inspects without executing and restores with retained history', async () => {
        const { work } = await setup();
        await click('Save history…');
        const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        expect(checkbox.checked).toBe(false);
        await act(async () => {
            Simulate.change(checkbox, { target: { checked: true } } as any);
        });
        expect(checkbox.checked).toBe(true);
        const id = writer!.state.recovery.entries[0].id;
        await act(async () => {
            work.setTitle('Changed title');
            await writer!.flush();
        });
        await act(async () => {
            Simulate.change(container.querySelector('select')!, { target: { value: id } } as any);
        });
        expect(container.querySelector('pre')?.textContent).toContain('Original title');
        expect(work.title).toBe('Changed title');
        await click('Restore as a new revision');
        expect(work.title).toBe('Original title');
        expect(writer!.state.recovery.entries).toHaveLength(3);
        expect(container.textContent).toContain('Revision restored and saved');
    });

    it('clearly labels the memory-only fallback', async () => {
        await setup(true);
        await click('Save history…');
        expect(container.textContent).toContain('Saved in memory only');
        expect(container.textContent).toContain('history disappears when you close the page');
    });
});
