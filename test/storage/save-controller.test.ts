import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Document } from '../../src/document';
import { MemoryStorage, serialize } from '../../src/storage';
import { SaveController } from '../../src/storage/save-controller';
import { checkpointSource } from '../../src/storage/checkpoints';

const controllers: SaveController[] = [];
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T00:00:00Z'));
});
afterEach(async () => {
    controllers.splice(0).forEach((controller) => controller.dispose());
    await Promise.resolve();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

async function setup() {
    const storage = new MemoryStorage();
    const doc = new Document();
    doc.setTitle('A long draft '.repeat(100));
    await storage.saveDocument('work', doc);
    let active = true;
    const onSaved = vi.fn();
    const writer = new SaveController(storage, 'work', doc, {
        persisted: true,
        isActive: () => active,
        onState: vi.fn(),
        onSaved,
    });
    controllers.push(writer);
    await writer.ready;
    return {
        storage,
        doc,
        writer,
        onSaved,
        active: (value: boolean) => {
            active = value;
        },
    };
}

describe('save lifecycle and checkpoint timing', () => {
    it('autosaves without opt-in and shows failures until a successful retry', async () => {
        const { writer, doc, storage } = await setup();
        const original = storage.saveDocument.bind(storage);
        const save = vi.spyOn(storage, 'saveDocument').mockRejectedValue(new Error('disk full'));
        doc.setTitle('Changed');
        expect(writer.state.status).toBe('pending');
        await vi.advanceTimersByTimeAsync(1000);
        expect(writer.state.status).toBe('error');
        expect(writer.state.error).toContain('disk full');
        doc.setTitle('Latest edit');
        expect(writer.state.status).toBe('error');
        save.mockImplementation(original);
        await writer.flush();
        expect(writer.state.status).toBe('saved');
        expect(writer.state.error).toBeNull();
        expect((await storage.getDocument('work'))?.title).toBe('Latest edit');
        expect((await storage.getRecovery('work')).entries).toEqual([]);
    });

    it('saves edits made during a pending write in order', async () => {
        const { writer, doc, storage, onSaved } = await setup();
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const original = storage.saveDocument.bind(storage);
        vi.spyOn(storage, 'saveDocument').mockImplementationOnce(async (id, snapshot) => {
            await gate;
            await original(id, snapshot);
        });
        doc.setTitle('First');
        const first = writer.flush();
        await Promise.resolve();
        expect(writer.state.status).toBe('saving');
        doc.setTitle('Second');
        expect(onSaved).not.toHaveBeenCalled();
        release();
        await first;
        expect((await storage.getDocument('work'))?.title).toBe('Second');
        expect(writer.state.status).toBe('saved');
        expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it('records minute diffs and ten-minute full snapshots only after opt-in', async () => {
        const { writer, doc, storage } = await setup();
        await writer.setEnabled(true);
        await writer.flush();
        for (let halfMinute = 0; halfMinute < 20; halfMinute++) {
            doc.setTitle(doc.title + '.');
            await vi.advanceTimersByTimeAsync(30_000);
        }
        const state = await storage.getRecovery('work');
        expect(state.activeMs).toBe(600_000);
        expect(state.entries).toHaveLength(11);
        expect(state.entries[1].kind).toBe('diff');
        expect(state.entries[10].kind).toBe('snapshot');
        expect(checkpointSource(state, state.entries[10].id)).toBe(serialize(doc));
    });

    it('rejects a flush if newer edits fail after an older version saved successfully', async () => {
        const { writer, doc, storage, onSaved } = await setup();
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const original = storage.saveDocument.bind(storage);
        vi.spyOn(storage, 'saveDocument')
            .mockImplementationOnce(async (id, snapshot) => {
                await gate;
                await original(id, snapshot);
            })
            .mockRejectedValueOnce(new Error('Full on newest draft'));
        doc.setTitle('Older version');
        const saving = writer.flush();
        const rejected = expect(saving).rejects.toThrow('Full on newest draft');
        await Promise.resolve();
        doc.setTitle('Newest version');
        release();
        await rejected;
        expect(writer.state.status).toBe('error');
        expect(doc.title).toBe('Newest version');
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('pauses for idle and hidden work and resumes a partial minute after reopening', async () => {
        const { writer, doc, storage, active } = await setup();
        await writer.setEnabled(true);
        await writer.flush();
        doc.setTitle(doc.title + 'edit');
        await vi.advanceTimersByTimeAsync(30_000);
        active(false);
        writer.tick();
        await writer.checkpoint(true);
        expect(writer.state.recovery.activeMs).toBe(30_000);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(writer.state.recovery.activeMs).toBe(30_000);
        writer.dispose();
        const resumed = new SaveController(storage, 'work', doc, {
            persisted: true,
            isActive: () => true,
            onState: vi.fn(),
        });
        controllers.push(resumed);
        await resumed.ready;
        doc.setTitle(doc.title + 'more');
        await vi.advanceTimersByTimeAsync(30_000);
        expect(resumed.state.recovery.activeMs).toBe(60_000);
        expect(resumed.state.recovery.entries).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(300_000);
        expect(resumed.state.recovery.activeMs).toBe(60_000); // No extra minute of active time after idle.
    });

    it('retains checkpoint time on write failure and retries without duplicating it', async () => {
        const { writer, doc, storage } = await setup();
        await writer.setEnabled(true);
        await writer.flush();
        const update = vi.spyOn(storage, 'updateRecovery').mockRejectedValue(new Error('quota'));
        doc.setTitle(doc.title + '.');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(writer.state.recoveryError).toContain('quota');
        expect(writer.state.recovery.activeMs).toBe(0);
        update.mockRestore();
        await writer.checkpoint();
        expect(writer.state.recovery.activeMs).toBe(60_000);
        expect(writer.state.recovery.entries).toHaveLength(2);
        expect(writer.state.recoveryError).toBeNull();
    });

    it('restores as a new revision, preserves the draft and supports undo', async () => {
        const { writer, doc } = await setup();
        const title = doc.title;
        await writer.setEnabled(true);
        await writer.flush();
        const original = writer.state.recovery.entries[0].id;
        doc.setTitle('Current draft');
        await writer.flush();
        await writer.restore(original);
        await writer.flush();
        expect(doc.title).toBe(title);
        const entries = writer.state.recovery.entries;
        expect(entries).toHaveLength(3);
        expect(checkpointSource(writer.state.recovery, entries[1].id)).toContain('Current draft');
        expect(entries[2].kind).toBe('snapshot');
        doc.undo();
        expect(doc.title).toBe('Current draft');
    });

    it('leaves the current draft alone if recovery cannot preserve it', async () => {
        const { writer, doc, storage } = await setup();
        await writer.setEnabled(true);
        await writer.flush();
        const original = writer.state.recovery.entries[0].id;
        doc.setTitle('Do not lose this draft');
        vi.spyOn(storage, 'updateRecovery').mockRejectedValue(new Error('quota'));
        await expect(writer.restore(original)).rejects.toThrow('quota');
        expect(doc.title).toBe('Do not lose this draft');
    });

    it('flushes pending edits on disposal without reopening a closed virtual tab', async () => {
        const { writer, doc, storage, onSaved } = await setup();
        doc.setTitle('Final edit');
        writer.dispose();
        await writer.flush();
        expect((await storage.getDocument('work'))?.title).toBe('Final edit');
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('does not resurrect a deleted work or its checkpoint history', async () => {
        const { writer, doc, storage } = await setup();
        await writer.setEnabled(true);
        await writer.flush();
        doc.setTitle('Pending edit');
        await storage.deleteDocument('work');
        await vi.advanceTimersByTimeAsync(60_000);
        await writer.flush();
        expect(await storage.getDocument('work')).toBeNull();
        expect((await storage.getRecovery('work')).entries).toEqual([]);
    });
});
