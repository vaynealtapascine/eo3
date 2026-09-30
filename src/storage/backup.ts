import { Document } from '../document';
import { fnv1a36 as hashSource } from '../util/hash';
import { listProfiles, replaceProfiles, PROFILE_TARGET_PREFIX } from '../targets/profile/store';
import { parseProfile, TargetProfile } from '../targets/profile/types';
import {
    checkpointSource,
    emptyRecovery,
    RecoveryState,
    MAX_CHECKPOINTS,
    textDiff,
} from './checkpoints';
import { LibraryGroup, listLibraryGroups, replaceLibraryGroups } from './group-library';
import { parseGroupFile } from './group-file';
import { deserialize, IStorage, nextDocumentId, serialize, StoredWork } from './index';

export interface LibraryBackup {
    eo3: 'backup';
    version: 1;
    createdAt: string;
    works: StoredWork[];
    groups: LibraryGroup[];
    profiles: TargetProfile[];
}

export async function createBackup(
    storage: IStorage,
    liveWorks = new Map<string, Document>()
): Promise<LibraryBackup> {
    const works = new Map((await storage.listStoredWorks()).map((work) => [work.id, work]));
    for (const [id, doc] of liveWorks)
        works.set(id, {
            id,
            title: doc.title,
            data: serialize(doc),
            dateModified: new Date().toISOString(),
            recovery: await storage.getRecovery(id),
        });
    return {
        eo3: 'backup',
        version: 1,
        createdAt: new Date().toISOString(),
        works: [...works.values()],
        groups: listLibraryGroups(),
        profiles: listProfiles(),
    };
}

function validateRecovery(value: unknown): RecoveryState {
    const state = value as RecoveryState;
    if (
        !state ||
        typeof state !== 'object' ||
        typeof state.enabled !== 'boolean' ||
        !Number.isFinite(state.activeMs) ||
        state.activeMs < 0 ||
        !Number.isFinite(state.snapshotAt) ||
        state.snapshotAt < 0 ||
        state.snapshotAt > state.activeMs ||
        !Array.isArray(state.entries) ||
        state.entries.length > MAX_CHECKPOINTS
    ) {
        throw new Error('The backup has invalid checkpoint history.');
    }
    const ids = new Set<string>();
    let previousTime = 0;
    for (const entry of state.entries) {
        if (
            !entry ||
            typeof entry.id !== 'string' ||
            !entry.id ||
            ids.has(entry.id) ||
            typeof entry.at !== 'string' ||
            !Number.isFinite(Date.parse(entry.at)) ||
            typeof entry.hash !== 'string' ||
            !Number.isFinite(entry.activeMs) ||
            entry.activeMs < previousTime ||
            entry.activeMs > state.activeMs ||
            (entry.kind !== 'snapshot' && entry.kind !== 'diff') ||
            (entry.kind === 'snapshot' && typeof entry.data !== 'string') ||
            (entry.kind === 'diff' && (!entry.data || typeof entry.data !== 'object'))
        ) {
            throw new Error('The backup has invalid checkpoint entries.');
        }
        ids.add(entry.id);
        previousTime = entry.activeMs;
        deserialize(checkpointSource(state, entry.id));
    }
    return structuredClone(state);
}

/** Validate everything before making any writes. Importing always makes independent work copies. */
export function parseBackup(source: string): LibraryBackup {
    let value: any;
    try {
        value = JSON.parse(source);
    } catch {
        throw new Error('This backup is not valid JSON.');
    }
    if (
        value?.eo3 !== 'backup' ||
        value.version !== 1 ||
        !Array.isArray(value.works) ||
        !Array.isArray(value.groups) ||
        !Array.isArray(value.profiles)
    ) {
        throw new Error('This is not a supported eo3 library backup.');
    }
    const ids = new Set<string>();
    const works: StoredWork[] = value.works.map((work: any) => {
        if (
            !work ||
            typeof work.id !== 'string' ||
            !work.id ||
            ids.has(work.id) ||
            typeof work.data !== 'string' ||
            typeof work.dateModified !== 'string' ||
            !Number.isFinite(Date.parse(work.dateModified))
        ) {
            throw new Error('The backup contains an invalid work.');
        }
        ids.add(work.id);
        const doc = deserialize(work.data);
        return {
            id: work.id,
            title: doc.title,
            data: serialize(doc),
            dateModified: work.dateModified,
            recovery:
                work.recovery === undefined ? emptyRecovery() : validateRecovery(work.recovery),
        };
    });
    const groupIds = new Set<string>();
    const groups: LibraryGroup[] = value.groups.map((group: any) => {
        if (!group || typeof group.id !== 'string' || !group.id || groupIds.has(group.id)) {
            throw new Error('The backup contains an invalid group.');
        }
        groupIds.add(group.id);
        return { id: group.id, file: parseGroupFile(JSON.stringify(group.file)) };
    });
    const profileIds = new Set<string>();
    const profiles: TargetProfile[] = value.profiles.map((value: unknown) => {
        const profile = parseProfile(value);
        if (typeof profile === 'string') throw new Error(profile);
        if (profileIds.has(profile.id))
            throw new Error('The backup contains duplicate custom sites.');
        profileIds.add(profile.id);
        return profile;
    });
    return { eo3: 'backup', version: 1, createdAt: value.createdAt, works, groups, profiles };
}

function remapTargets(source: string, targetIds: Map<string, string>) {
    const doc = deserialize(source);
    const remap = <T>(map: Record<string, T>): Record<string, T> =>
        Object.fromEntries(
            Object.entries(map).map(([key, value]) => [targetIds.get(key) ?? key, value])
        );
    doc.init({
        ...doc.state,
        parts: doc.parts.map((part) => ({ ...part, postedTo: remap(part.postedTo) })),
        skinRecords: remap(doc.state.skinRecords),
        skinBaselines: remap(doc.state.skinBaselines),
        protectedSkinClasses: remap(doc.state.protectedSkinClasses),
    });
    return serialize(doc);
}

export async function importBackup(storage: IStorage, source: string): Promise<string[]> {
    const backup = parseBackup(source);
    const oldProfiles = listProfiles();
    const oldGroups = listLibraryGroups();
    const profiles = oldProfiles.slice();
    const targetIds = new Map<string, string>();
    for (const profile of backup.profiles) {
        const existing = profiles.find((candidate) => candidate.id === profile.id);
        if (existing && JSON.stringify(existing) === JSON.stringify(profile)) continue;
        const id = existing ? `import-${crypto.randomUUID()}` : profile.id;
        profiles.push({ ...profile, id });
        targetIds.set(PROFILE_TARGET_PREFIX + profile.id, PROFILE_TARGET_PREFIX + id);
    }
    const works = backup.works.map((work) => {
        let recovery = work.recovery;
        if (targetIds.size) {
            // Target ids occur inside revision contents too; keep their incremental encoding.
            let previous = '';
            recovery = {
                ...recovery,
                entries: recovery.entries.map((entry) => {
                    const data = remapTargets(checkpointSource(recovery, entry.id), targetIds);
                    const updated = {
                        ...entry,
                        hash: hashSource(data),
                        ...(entry.kind === 'snapshot'
                            ? { kind: 'snapshot' as const, data }
                            : { kind: 'diff' as const, data: textDiff(previous, data) }),
                    };
                    previous = data;
                    return updated;
                }),
            };
        }
        return {
            ...work,
            id: nextDocumentId(),
            data: remapTargets(work.data, targetIds),
            recovery,
        };
    });
    const groups = [
        ...oldGroups,
        ...backup.groups.map((group) => ({ ...group, id: crypto.randomUUID() })),
    ];
    let profilesWritten = false;
    let groupsWritten = false;
    try {
        // IDB commits all imported works/history atomically. Roll back library writes if it fails.
        replaceProfiles(profiles);
        profilesWritten = true;
        replaceLibraryGroups(groups);
        groupsWritten = true;
        await storage.importStoredWorks(works);
    } catch (error) {
        const rollback: string[] = [];
        try {
            if (profilesWritten) replaceProfiles(oldProfiles);
        } catch {
            rollback.push('custom sites');
        }
        try {
            if (groupsWritten) replaceLibraryGroups(oldGroups);
        } catch {
            rollback.push('My groups');
        }
        if (rollback.length)
            throw new Error(
                `${String(error)} Library rollback also failed for ${rollback.join(', ')}.`
            );
        throw error;
    }
    return works.map((work) => work.id);
}
