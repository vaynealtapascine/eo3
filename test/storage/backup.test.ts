import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Document } from '../../src/document';
import { createBackup, importBackup, parseBackup } from '../../src/storage/backup';
import { appendCheckpoint, checkpointSource, emptyRecovery } from '../../src/storage/checkpoints';
import { MemoryStorage, serialize } from '../../src/storage';
import { listLibraryGroups, saveLibraryGroup } from '../../src/storage/group-library';
import { listProfiles, saveProfile } from '../../src/targets/profile/store';
import { newProfile } from '../../src/targets/profile/types';

beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

async function library() {
    const storage = new MemoryStorage();
    const doc = new Document();
    doc.setTitle('Saved draft');
    await storage.saveDocument('work', doc);
    await storage.updateRecovery('work', (state) =>
        appendCheckpoint({ ...state, enabled: true }, serialize(doc))
    );
    saveLibraryGroup({
        eo3: 'group',
        version: 1,
        title: 'Reusable letter',
        modules: [{ plugin: 'source.text', data: { language: 'html', contents: '<p>Letter</p>' } }],
    });
    saveProfile(newProfile('custom'));
    return { storage, doc };
}

describe('complete library backups', () => {
    it('includes live edits and round-trips works, history, ordered groups and profiles as copies', async () => {
        const { storage, doc } = await library();
        doc.setTitle('Latest unsaved edit');
        const backup = await createBackup(storage, new Map([['work', doc]]));
        expect(backup.works[0].data).toContain('Latest unsaved edit');
        expect(backup.works[0].recovery.enabled).toBe(true);
        const destination = new MemoryStorage();
        localStorage.clear();
        const ids = await importBackup(destination, JSON.stringify(backup));
        expect(ids[0]).not.toBe('work');
        expect((await destination.getDocument(ids[0]))?.title).toBe('Latest unsaved edit');
        const recovery = await destination.getRecovery(ids[0]);
        expect(checkpointSource(recovery, recovery.entries[0].id)).toContain('Saved draft');
        expect(listLibraryGroups().map((g) => g.file.title)).toEqual(['Reusable letter']);
        expect(listProfiles().map((p) => p.id)).toEqual(['custom']);
        expect(await destination.getOpenDocuments()).toEqual(ids);
    });

    it('preserves conflicting profiles and remaps target posting state in drafts and revisions', async () => {
        const { storage, doc } = await library();
        doc.setPartPosted(
            'profile:custom',
            doc.parts[0].id,
            {
                at: '2026-09-30',
                classes: [],
                htmlHash: 'hash',
                skinCss: 'css',
            },
            {}
        );
        await storage.saveDocument('work', doc);
        await storage.updateRecovery('work', () =>
            appendCheckpoint({ ...emptyRecovery(), enabled: true }, serialize(doc))
        );
        const backup = await createBackup(storage);
        saveProfile({ ...newProfile('custom'), title: 'Existing different site' });
        const ids = await importBackup(storage, JSON.stringify(backup));
        const profiles = listProfiles();
        expect(profiles).toHaveLength(2);
        expect(profiles[0].title).toBe('Existing different site');
        const target = 'profile:' + profiles[1].id;
        const copy = (await storage.getDocument(ids[0]))!;
        expect(Object.keys(copy.parts[0].postedTo)).toEqual([target]);
        expect(copy.state.skinBaselines[target]).toBe('css');
        const recovery = await storage.getRecovery(ids[0]);
        expect(checkpointSource(recovery, recovery.entries[0].id)).toContain(target);
        expect(
            (await storage.getDocument('work'))?.parts[0].postedTo['profile:custom']
        ).toBeDefined();
    });

    it('rejects corrupted history before any writes', async () => {
        const { storage } = await library();
        const backup = await createBackup(storage);
        backup.works[0].recovery.entries[0].hash = 'damaged';
        const importWorks = vi.spyOn(storage, 'importStoredWorks');
        const before = localStorage.getItem('eo3:group-library');
        await expect(importBackup(storage, JSON.stringify(backup))).rejects.toThrow('damaged');
        expect(importWorks).not.toHaveBeenCalled();
        expect(localStorage.getItem('eo3:group-library')).toBe(before);
    });

    it('rolls libraries back when the atomic work import fails', async () => {
        const { storage } = await library();
        const backup = await createBackup(storage);
        const profiles = listProfiles();
        const groups = listLibraryGroups();
        vi.spyOn(storage, 'importStoredWorks').mockRejectedValue(new Error('database full'));
        await expect(importBackup(storage, JSON.stringify(backup))).rejects.toThrow(
            'database full'
        );
        expect(listProfiles()).toEqual(profiles);
        expect(listLibraryGroups()).toEqual(groups);
        expect(await storage.listAllDocumentIds()).toEqual(['work']);
    });

    it('validates the backup format and duplicate work ids', async () => {
        expect(() => parseBackup('not json')).toThrow('valid JSON');
        expect(() => parseBackup('{"eo3":"backup","version":2}')).toThrow('supported');
        const { storage } = await library();
        const backup = await createBackup(storage);
        backup.works.push(backup.works[0]);
        expect(() => parseBackup(JSON.stringify(backup))).toThrow('invalid work');
    });
});
