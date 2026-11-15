import { createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Document } from '../../src/document';
import { MemoryStorage } from '../../src/storage';
import { StartupError } from '../../src/ui/startup-error';
import { showConfirm } from '../../src/ui/dialogs';
import { downloadFile } from '../../src/util/download';

vi.mock('../../src/ui/dialogs', () => ({
    showAlert: vi.fn(),
    showConfirm: vi.fn(async () => false),
}));
vi.mock('../../src/util/download', () => ({ downloadFile: vi.fn() }));

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
const render = (storage: MemoryStorage) =>
    act(() =>
        root.render(createElement(StartupError, { error: new Error('VersionError'), storage }))
    );

describe('startup error screen', () => {
    it('offers a backup of the saved works before anything destructive', async () => {
        const storage = new MemoryStorage();
        const work = new Document();
        work.setTitle('My story');
        await storage.saveDocument('work', work);
        render(storage);

        const labels = [...container.querySelectorAll('button')].map((node) => node.textContent);
        expect(labels).toEqual(['Reload', 'Download backup', 'Delete all eo3 data…']);
        // the raw error is there for a bug report, but not the first thing a writer reads
        expect(container.querySelector('details pre')?.textContent).toContain('VersionError');

        await click('Download backup');
        expect(downloadFile).toHaveBeenCalledTimes(1);
        const [json, name] = vi.mocked(downloadFile).mock.calls[0];
        expect(JSON.parse(json as string).works[0].title).toBe('My story');
        expect(name).toMatch(/^eo3-backup-\d{4}-\d\d-\d\d\.json$/);
        expect(container.querySelector('[role="status"]')?.textContent).toContain('1 work');
    });

    it('warns against deleting when the works cannot be backed up', async () => {
        const storage = new MemoryStorage();
        vi.spyOn(storage, 'listStoredWorks').mockRejectedValue(new Error('database is closed'));
        render(storage);

        await click('Download backup');
        expect(downloadFile).not.toHaveBeenCalled();
        const status = container.querySelector('[role="status"]')!;
        expect(status.textContent).toContain('couldn’t be made');
        expect(status.textContent).toContain('database is closed');
        expect(status.className).toContain('is-failed');
    });

    it('asks before deleting and keeps the data when the answer is no', async () => {
        const storage = new MemoryStorage();
        const close = vi.spyOn(storage, 'close');
        render(storage);

        await click('Delete all eo3 data…');
        expect(showConfirm).toHaveBeenCalledTimes(1);
        expect(close).not.toHaveBeenCalled();
    });
});
