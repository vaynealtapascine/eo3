import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { Document } from '../../src/document';
import {
    initStorage,
    MemoryStorage,
    recordCheckpoint,
    serialize,
    Storage,
    StoredWork,
} from '../../src/storage';
import { emptyRecovery, checkpointSource } from '../../src/storage/checkpoints';
import { migrateV1, SchemaV1 } from '../../src/storage/versions/v1';

let storage: Storage | undefined;
afterEach(async () => {
    storage?.close();
    storage = undefined;
    await deleteDB('eo3_data');
});

describe('recovery persistence', () => {
    it('upgrades existing v1 works and tabs without changing saved files', async () => {
        const old = await openDB<SchemaV1>('eo3_data', 1, {
            upgrade(db, _old, _new, tx) {
                void migrateV1(db, tx);
            },
        });
        const doc = new Document();
        doc.setTitle('Existing draft');
        await old.put(
            'documents',
            {
                id: 'old',
                title: doc.title,
                data: serialize(doc),
                dateModified: new Date().toISOString(),
            },
            'old'
        );
        await old.put('openDocuments', { id: 'old' });
        old.close();
        storage = await initStorage();
        expect(storage.db.version).toBe(2);
        expect((await storage.getDocument('old'))?.title).toBe('Existing draft');
        expect(await storage.getOpenDocuments()).toEqual(['old']);
        expect(await storage.getRecovery('old')).toEqual(emptyRecovery());
        expect(JSON.parse(serialize(doc, 'json')).version).toBe(1);
    });

    it('serializes concurrent checkpoint transactions and survives reopening', async () => {
        storage = await initStorage();
        const doc = new Document();
        doc.setTitle('A long draft title '.repeat(30));
        await storage.saveDocument('work', doc);
        await storage.updateRecovery('work', (state) => ({ ...state, enabled: true }));
        await recordCheckpoint(storage, 'work', serialize(doc));
        doc.setTitle(doc.title + 'revision');
        await Promise.all([
            recordCheckpoint(storage, 'work', serialize(doc), 60_000),
            recordCheckpoint(storage, 'work', serialize(doc), 60_000),
        ]);
        storage.close();
        storage = await initStorage();
        const state = await storage.getRecovery('work');
        expect(state.activeMs).toBe(120_000);
        expect(state.entries).toHaveLength(2);
        expect(checkpointSource(state, state.entries[1].id)).toBe(serialize(doc));
    });

    it('imports all works/history atomically and refuses overwrites', async () => {
        storage = await initStorage();
        const doc = new Document();
        doc.setTitle('Keep me');
        await storage.saveDocument('existing', doc);
        const record: StoredWork = {
            id: 'new',
            title: 'New',
            data: serialize(doc),
            dateModified: new Date().toISOString(),
            recovery: emptyRecovery(),
        };
        await expect(
            storage.importStoredWorks([record, { ...record, id: 'existing' }])
        ).rejects.toThrow();
        expect(await storage.getDocument('new')).toBeNull();
        expect((await storage.getDocument('existing'))?.title).toBe('Keep me');
        expect(await storage.getOpenDocuments()).toEqual([]);
    });

    it('deletes work, history and open-tab records together', async () => {
        storage = await initStorage();
        await storage.saveDocument('work', new Document());
        await storage.addOpenDocument('work');
        await recordCheckpoint(storage, 'work', serialize(new Document()), 0, true);
        await storage.deleteDocument('work');
        expect(await storage.listStoredWorks()).toEqual([]);
        expect(await storage.getRecovery('work')).toEqual(emptyRecovery());
        expect(await storage.getOpenDocuments()).toEqual([]);
    });

    it('memory fallback stores independent draft snapshots', async () => {
        const memory = new MemoryStorage();
        const doc = new Document();
        doc.setTitle('Saved');
        await memory.saveDocument('work', doc);
        doc.setTitle('Unsaved');
        expect((await memory.getDocument('work'))?.title).toBe('Saved');
        await memory.addOpenDocument('work');
        await memory.deleteDocument('work');
        expect(await memory.getOpenDocuments()).toEqual([]);
    });
});
