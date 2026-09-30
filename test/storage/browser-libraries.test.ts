import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    listProfiles,
    saveProfile,
    deleteProfile,
    subscribeProfiles,
} from '../../src/targets/profile/store';
import { newProfile } from '../../src/targets/profile/types';
import {
    listLibraryGroups,
    saveLibraryGroup,
    removeLibraryGroup,
    moveLibraryGroup,
    subscribeLibraryGroups,
} from '../../src/storage/group-library';
import { GroupFile } from '../../src/storage/group-file';

const group = (title: string): GroupFile => ({
    eo3: 'group',
    version: 1,
    title,
    modules: [{ plugin: 'source.text', data: { contents: title } }],
});
const unsubscribers: (() => void)[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    vi.restoreAllMocks();
});

describe('browser libraries', () => {
    it('keeps existing formats, group order and replacement semantics', () => {
        saveProfile(newProfile('site'));
        saveProfile({ ...newProfile('site'), title: 'Updated' });
        expect(listProfiles().map((p) => p.title)).toEqual(['Updated']);
        saveLibraryGroup(group('One'));
        saveLibraryGroup(group('Two'));
        const [one, two] = listLibraryGroups();
        moveLibraryGroup(two.id, 0);
        expect(listLibraryGroups().map((g) => g.file.title)).toEqual(['Two', 'One']);
        removeLibraryGroup(one.id);
        expect(JSON.parse(localStorage.getItem('eo3:group-library')!)).toEqual([two]);
        deleteProfile('site');
        expect(listProfiles()).toEqual([]);
    });

    it('skips malformed entries without discarding valid neighbors', () => {
        localStorage.setItem(
            'eo3:target-profiles',
            JSON.stringify([
                null,
                newProfile('ok'),
                { ...newProfile('bad'), delivery: 'constructor' },
            ])
        );
        localStorage.setItem(
            'eo3:group-library',
            JSON.stringify([
                null,
                { file: group('missing id') },
                { id: 'valid', file: group('Valid') },
            ])
        );
        expect(listProfiles().map((p) => p.id)).toEqual(['ok']);
        expect(listLibraryGroups().map((g) => g.id)).toEqual(['valid']);
    });

    it('reports failed mutations and never announces them as successful changes', () => {
        saveProfile(newProfile('site'));
        saveLibraryGroup(group('One'));
        const id = listLibraryGroups()[0].id;
        const changed = vi.fn();
        unsubscribers.push(subscribeProfiles(changed), subscribeLibraryGroups(changed));
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('Full', 'QuotaExceededError');
        });
        for (const mutate of [
            () => saveProfile(newProfile('new')),
            () => deleteProfile('site'),
            () => saveLibraryGroup(group('Two')),
            () => removeLibraryGroup(id),
            () => moveLibraryGroup(id, 0),
        ])
            expect(mutate).toThrow('Storage may be full or blocked');
        expect(changed).not.toHaveBeenCalled();
        expect(listProfiles().map((p) => p.id)).toEqual(['site']);
        expect(listLibraryGroups().map((g) => g.file.title)).toEqual(['One']);
    });

    it('notifies for local writes and other tabs, and unsubscribes cleanly', () => {
        const changed = vi.fn();
        const unsubscribe = subscribeProfiles(changed);
        unsubscribers.push(unsubscribe);
        saveProfile(newProfile('site'));
        expect(changed).toHaveBeenCalledTimes(1);
        const event = (key: string | null, storageArea = localStorage) =>
            window.dispatchEvent(new StorageEvent('storage', { key, storageArea }));
        event('eo3:group-library');
        event('eo3:target-profiles', sessionStorage);
        expect(changed).toHaveBeenCalledTimes(1);
        event('eo3:target-profiles');
        event(null);
        expect(changed).toHaveBeenCalledTimes(3);
        unsubscribe();
        event(null);
        saveProfile(newProfile('another'));
        expect(changed).toHaveBeenCalledTimes(3);
    });
});
