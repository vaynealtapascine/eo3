import { createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Document, Module, ModulePlugin } from '../../src/document';
import { MemoryStorage } from '../../src/storage';
import { SaveController, SaveState } from '../../src/storage/save-controller';
import {
    describeVersion,
    SaveErrorBanner,
    SaveStatus,
    VersionHistory,
} from '../../src/ui/components/save-recovery';

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
    let historyOpen = false;
    let latest: SaveState;
    const render = (state: SaveState) => {
        latest = state;
        root.render(
            createElement(
                'div',
                null,
                createElement(SaveStatus, {
                    state,
                    memoryOnly,
                    onOpenHistory: () => {
                        historyOpen = true;
                        render(latest);
                    },
                }),
                createElement(SaveErrorBanner, { state, controller: writer!, work }),
                createElement(VersionHistory, {
                    open: historyOpen,
                    onClose: () => {
                        historyOpen = false;
                        render(latest);
                    },
                    state,
                    controller: writer!,
                    memoryOnly,
                })
            )
        );
    };
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
        expect(container.querySelector('.save-status')?.textContent).toBe('Couldn’t save');
        expect(container.textContent).toContain('Storage full');
        expect(container.textContent).toContain('Download work');
        save.mockImplementation(original);
        await click('Retry save');
        expect(container.querySelector('.save-status')?.textContent).toBe('Saved');
        expect(container.querySelector('.save-error-banner')).toBeNull();
        expect((await storage.getDocument('work'))?.title).toBe('Latest writing');
    });

    it('opts in, inspects without executing and restores with retained history', async () => {
        const { work } = await setup();
        await click('Saved');
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
        const versions = [...container.querySelectorAll<HTMLButtonElement>('.i-versions button')];
        expect(versions).toHaveLength(writer!.state.recovery.entries.length);
        // Newest first: the oldest version is the one taken when history was turned on.
        expect(writer!.state.recovery.entries[0].id).toBe(id);
        await act(async () => versions.at(-1)!.click());
        expect(container.querySelector('pre')?.textContent).toContain('Original title');
        expect(work.title).toBe('Changed title');
        await click('Restore this version');
        expect(work.title).toBe('Original title');
        expect(writer!.state.recovery.entries).toHaveLength(3);
        expect(container.textContent).toContain('Restored.');
    });

    it('labels each version with what changed since the one before', async () => {
        const { work } = await setup();
        await click('Saved');
        await act(async () => {
            Simulate.change(container.querySelector('input[type="checkbox"]')!, {
                target: { checked: true },
            } as any);
        });
        const text: ModulePlugin<any> = {
            id: 'source.text',
            acceptsInputs: false,
            acceptsNamedInputs: false,
            component: () => null,
            initialData: () => ({ contents: '', language: 'html' }),
            description: () => 'HTML',
            eval: async () => null as any,
        };
        await act(async () => {
            work.insertModule(
                new Module(text, { contents: '<p>Three short words</p>', language: 'html' })
            );
            // a version is recorded after a minute of editing
            await vi.advanceTimersByTimeAsync(60_000);
        });
        await act(async () => {
            work.addPart('Second');
            await vi.advanceTimersByTimeAsync(60_000);
        });
        const details = [...container.querySelectorAll('.i-versions .i-detail')].map(
            (node) => node.textContent
        );
        // newest first; the oldest shows where the history starts
        expect(details).toEqual(['latest · 1 chapter added', '+3 words', '0 words · 1 chapter']);
    });

    it('describes changes between versions in a writer’s terms', () => {
        const before = { words: 1200, chapters: 3 };
        expect(describeVersion(undefined, before)).toBe('');
        expect(describeVersion(null, before)).toBe('can’t be read');
        expect(describeVersion(before, null)).toBe('1,200 words · 3 chapters');
        expect(describeVersion({ words: 1285, chapters: 3 }, before)).toBe('+85 words');
        expect(describeVersion({ words: 900, chapters: 2 }, before)).toBe(
            '−300 words · 1 chapter removed'
        );
        expect(describeVersion({ words: 1200, chapters: 5 }, before)).toBe('2 chapters added');
        expect(describeVersion(before, before)).toBe('same word count');
        // a version after one that can't be read stands on its own
        expect(describeVersion(before, undefined)).toBe('1,200 words · 3 chapters');
    });

    it('clearly labels the memory-only fallback', async () => {
        await setup(true);
        await click('Saved in memory');
        expect(container.textContent).toContain('history disappears when you close the page');
    });
});
