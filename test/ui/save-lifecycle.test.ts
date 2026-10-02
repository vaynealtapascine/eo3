import { createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Document } from '../../src/document';
import { MemoryStorage } from '../../src/storage';
import { showAlert } from '../../src/ui/dialogs';

vi.mock('../../src/ui/eo3', () => ({
    Eo3: ({ document }: { document: Document }) =>
        createElement('input', {
            'aria-label': 'Work title',
            value: document.title,
            onChange: (event: { target: { value: string } }) =>
                document.setTitle(event.target.value),
        }),
}));
vi.mock('../../src/ui/sidebar', () => ({ ApplicationSidebar: () => null }));
vi.mock('../../src/ui/dialogs', () => ({
    showAlert: vi.fn(async () => {}),
    showConfirm: vi.fn(async () => true),
}));
vi.mock('../../src/uikit/dir-popover', () => ({
    DirPopover: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
        open ? children : null,
}));
vi.mock('../../src/storage', async (original) => {
    const actual = await original<typeof import('../../src/storage')>();
    return {
        ...actual,
        getExampleDocument: async () => {
            const doc = new Document();
            doc.setTitle('Example');
            return doc;
        },
    };
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })),
    });
    vi.spyOn(Document.prototype, 'ensureSharedStyles').mockResolvedValue();
    Object.defineProperty(Element.prototype, 'getAnimations', {
        configurable: true,
        value: () => [],
    });
    Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        value: () => ({ cancel: vi.fn(), finished: Promise.resolve() }),
    });
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
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLDialogElement.prototype as any).showModal;
    delete (HTMLDialogElement.prototype as any).close;
    delete (Element.prototype as any).getAnimations;
    delete (Element.prototype as any).animate;
});
async function render(storage: MemoryStorage) {
    const { default: ApplicationFrame } = await import('../../src/ui/index');
    await act(async () => root.render(createElement(ApplicationFrame, { storage })));
}
async function changeTitle(title: string) {
    await act(async () =>
        Simulate.change(container.querySelector('input[aria-label="Work title"]')!, {
            target: { value: title },
        } as any)
    );
}
async function close() {
    await act(async () => container.querySelector<HTMLButtonElement>('.i-close')!.click());
}

describe('application save lifecycle', () => {
    it('keeps a saved work open when closing cannot flush its newest edit', async () => {
        const storage = new MemoryStorage();
        const work = new Document();
        work.setTitle('Original');
        await storage.saveDocument('work', work);
        await storage.addOpenDocument('work');
        await render(storage);
        vi.spyOn(storage, 'saveDocument').mockRejectedValue(new Error('Full'));
        await changeTitle('Do not lose this');
        await close();
        expect(
            container.querySelector<HTMLInputElement>('input[aria-label="Work title"]')?.value
        ).toBe('Do not lose this');
        expect(showAlert).toHaveBeenCalledWith(
            expect.stringContaining('tab stays open'),
            expect.anything()
        );
        expect(await storage.getOpenDocuments()).toEqual(['work']);
    });

    it('keeps a virtual work editable when its first save fails', async () => {
        const storage = new MemoryStorage();
        await render(storage);
        vi.spyOn(storage, 'saveDocument').mockRejectedValue(new Error('Full'));
        await changeTitle('Unsaved example edits');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(container.textContent).toContain('Couldn’t save this work');
        await close();
        expect(
            container.querySelector<HTMLInputElement>('input[aria-label="Work title"]')?.value
        ).toBe('Unsaved example edits');
        expect(await storage.listAllDocumentIds()).toEqual([]);
    });

    it('flushes and closes a virtual work without leaving its realized tab open', async () => {
        const storage = new MemoryStorage();
        await render(storage);
        await changeTitle('Saved on close');
        await close();
        expect(container.querySelector('input[aria-label="Work title"]')).toBeNull();
        expect(await storage.getOpenDocuments()).toEqual([]);
        const works = await storage.listStoredWorks();
        expect(works).toHaveLength(1);
        expect(works[0].title).toBe('Saved on close');
    });
});
