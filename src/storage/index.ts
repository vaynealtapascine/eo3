import { IDBPCursorWithValue, IDBPDatabase, IDBPObjectStore, openDB } from 'idb';
import { deserialize, migrate, Schema, serialize, nextDocumentId } from './versions';
import { Document } from '../document';
import { appendCheckpoint, emptyRecovery, RecoveryState } from './checkpoints';

export interface StoredWork extends DocumentInfo {
    data: string;
    recovery: RecoveryState;
}

export async function initStorage(): Promise<Storage> {
    const newVersion = 2;
    const db = await openDB<Schema>('eo3_data', newVersion, {
        async upgrade(database: IDBPDatabase<any>, old, _, transaction) {
            console.log(`upgrade database ${old} → ${newVersion}`);
            await migrate(database, old, newVersion, transaction);
        },
        blocking(currentVersion: number, blockedVersion: number | null) {
            if (blockedVersion! > currentVersion) {
                // whatever, just reload
                window.location.reload();
            }
        },
    });

    return new Storage(db);
}

export { deserialize, serialize, nextDocumentId };

export async function getExampleDocument(id: string) {
    const res = await fetch(new URL(`../../assets/examples/${id}`, import.meta.url));
    if (!res.ok) throw await res.text();
    const docData = await res.text();
    return deserialize(docData);
}

export interface DocumentInfo {
    id: string;
    title: string;
    /** ISO date string */
    dateModified: string;
}

export interface IStorage {
    getOpenDocuments(): Promise<string[]>;
    addOpenDocument(doc: string): Promise<void>;
    removeOpenDocument(doc: string): Promise<void>;
    hasAnySavedDocuments(): Promise<boolean>;
    listAllDocumentIds(): Promise<string[]>;
    listDocumentsByDate(fromDate: string | null, count: number): Promise<DocumentInfo[]>;
    listDocumentsByIdInclusive(fromId: string, count: number): Promise<DocumentInfo[]>;
    getDocument(id: string): Promise<Document | null>;
    saveDocument(id: string, doc: Document): Promise<void>;
    deleteDocument(id: string): Promise<void>;
    getRecovery(id: string): Promise<RecoveryState>;
    updateRecovery(
        id: string,
        update: (state: RecoveryState) => RecoveryState
    ): Promise<RecoveryState>;
    listStoredWorks(): Promise<StoredWork[]>;
    importStoredWorks(works: StoredWork[]): Promise<void>;
    close(): void;

    addEventListener(event: string, handler: EventListener): void;
    removeEventListener(event: string, handler: EventListener): void;
}

export class Storage extends EventTarget implements IStorage {
    db: IDBPDatabase<Schema>;

    constructor(db: IDBPDatabase<Schema>) {
        super();
        this.db = db;
    }

    async getOpenDocuments(): Promise<string[]> {
        return await this.db.getAllKeys('openDocuments');
    }

    async addOpenDocument(doc: string): Promise<void> {
        await this.db.put('openDocuments', { id: doc });
        this.dispatchEvent(new CustomEvent('update-open-documents'));
    }

    async removeOpenDocument(doc: string): Promise<void> {
        await this.db.delete('openDocuments', doc);
        this.dispatchEvent(new CustomEvent('update-open-documents'));
    }

    async hasAnySavedDocuments(): Promise<boolean> {
        const res = await this.listDocumentsByDate(null, 1);
        return !!res.length;
    }

    listAllDocumentIds(): Promise<string[]> {
        return this.db
            .getAllKeysFromIndex('documents', 'byDateModified')
            .then((res) => res.reverse());
    }

    private async listDocumentsImpl(
        openCursor: (
            store: IDBPObjectStore<Schema, any, 'documents'>
        ) => Promise<IDBPCursorWithValue<Schema, any, any> | null>,
        count: number
    ): Promise<DocumentInfo[]> {
        const trans = this.db.transaction('documents');
        const cursor = await openCursor(trans.objectStore('documents'));
        if (!cursor) return [];

        const results = [];

        for (let i = 0; i < count; i++) {
            results.push({
                id: cursor.value.id,
                title: cursor.value.title,
                dateModified: cursor.value.dateModified,
            });

            if (!(await cursor.continue())) break;
        }
        return results;
    }

    listDocumentsByDate(fromDate: string | null, count: number): Promise<DocumentInfo[]> {
        return this.listDocumentsImpl(
            (store) =>
                store
                    .index('byDateModified')
                    .openCursor(fromDate ? IDBKeyRange.upperBound(fromDate, true) : null, 'prev'),
            count
        );
    }

    listDocumentsByIdInclusive(fromId: string, count: number): Promise<DocumentInfo[]> {
        return this.listDocumentsImpl(
            (store) => store.openCursor(IDBKeyRange.upperBound(fromId), 'prev'),
            count
        );
    }

    async getDocument(id: string): Promise<Document | null> {
        const docData = await this.db.get('documents', id);
        if (!docData) return null;
        return deserialize(docData.data);
    }

    async saveDocument(id: string, doc: Document) {
        await this.db.put(
            'documents',
            {
                id,
                title: doc.title,
                data: serialize(doc),
                dateModified: new Date().toISOString(),
            },
            id
        );
        this.dispatchEvent(new CustomEvent('update-documents'));
    }

    async deleteDocument(id: string) {
        const tx = this.db.transaction(['documents', 'openDocuments', 'recovery'], 'readwrite');
        await tx.objectStore('documents').delete(id);
        await tx.objectStore('openDocuments').delete(id);
        await tx.objectStore('recovery').delete(id);
        await tx.done;
        this.dispatchEvent(new CustomEvent('update-documents'));
        this.dispatchEvent(new CustomEvent('update-open-documents'));
        this.dispatchEvent(new CustomEvent('delete-document', { detail: id }));
    }

    close() {
        this.db.close();
    }

    async getRecovery(id: string): Promise<RecoveryState> {
        return (await this.db.get('recovery', id)) ?? emptyRecovery();
    }

    async updateRecovery(id: string, update: (state: RecoveryState) => RecoveryState) {
        const tx = this.db.transaction('recovery', 'readwrite');
        const store = tx.objectStore('recovery');
        try {
            const state = update((await store.get(id)) ?? emptyRecovery());
            await store.put(state, id);
            await tx.done;
            this.dispatchEvent(new CustomEvent('update-recovery', { detail: id }));
            return state;
        } catch (error) {
            try {
                tx.abort();
            } catch {
                /* Already aborted or completed. */
            }
            await tx.done.catch(() => {});
            throw error;
        }
    }

    async listStoredWorks(): Promise<StoredWork[]> {
        const tx = this.db.transaction(['documents', 'recovery']);
        const documents = await tx.objectStore('documents').getAll();
        const works = await Promise.all(
            documents.map(async (doc) => ({
                ...doc,
                recovery: (await tx.objectStore('recovery').get(doc.id)) ?? emptyRecovery(),
            }))
        );
        await tx.done;
        return works;
    }

    async importStoredWorks(works: StoredWork[]) {
        const tx = this.db.transaction(['documents', 'recovery', 'openDocuments'], 'readwrite');
        try {
            for (const { recovery, ...doc } of works) {
                // add() prevents an accidental overwrite, even if another tab imports concurrently.
                await tx.objectStore('documents').add(doc, doc.id);
                await tx.objectStore('recovery').add(recovery, doc.id);
                await tx.objectStore('openDocuments').put({ id: doc.id });
            }
            await tx.done;
        } catch (error) {
            try {
                tx.abort();
            } catch {
                /* Already aborted or completed. */
            }
            await tx.done.catch(() => {});
            throw error;
        }
        this.dispatchEvent(new CustomEvent('update-documents'));
        this.dispatchEvent(new CustomEvent('update-open-documents'));
    }
}

export class MemoryStorage extends EventTarget implements IStorage {
    documents = new Map<string, { doc: Document; dateModified: Date }>();
    openDocuments = new Set<string>();
    recovery = new Map<string, RecoveryState>();

    async addOpenDocument(doc: string): Promise<void> {
        this.openDocuments.add(doc);
        this.dispatchEvent(new CustomEvent('update-open-documents'));
    }

    close(): void {
        // bye
    }

    async deleteDocument(id: string): Promise<void> {
        this.documents.delete(id);
        this.openDocuments.delete(id);
        this.recovery.delete(id);
        this.dispatchEvent(new CustomEvent('update-documents'));
        this.dispatchEvent(new CustomEvent('update-open-documents'));
        this.dispatchEvent(new CustomEvent('delete-document', { detail: id }));
    }

    async getDocument(id: string): Promise<Document | null> {
        const doc = this.documents.get(id)?.doc;
        return doc ? deserialize(serialize(doc)) : null;
    }

    async getOpenDocuments(): Promise<string[]> {
        return [...this.openDocuments];
    }

    async hasAnySavedDocuments(): Promise<boolean> {
        return this.documents.size > 0;
    }

    async listAllDocumentIds(): Promise<string[]> {
        return [...this.documents.keys()];
    }

    async listDocumentsByDate(fromDate: string | null, count: number): Promise<DocumentInfo[]> {
        return [...this.documents]
            .filter(([, entry]) => (fromDate ? +entry.dateModified <= +new Date(fromDate) : true))
            .sort(([, a], [, b]) => +b.dateModified - +a.dateModified)
            .slice(0, count)
            .map(([id, entry]) => ({
                id,
                title: entry.doc.title,
                dateModified: entry.dateModified.toISOString(),
            }));
    }

    async listDocumentsByIdInclusive(fromId: string, count: number): Promise<DocumentInfo[]> {
        return [...this.documents]
            .filter(([id]) => id.localeCompare(fromId) >= 0)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(0, count)
            .map(([id, entry]) => ({
                id,
                title: entry.doc.title,
                dateModified: entry.dateModified.toISOString(),
            }));
    }

    async removeOpenDocument(doc: string): Promise<void> {
        this.openDocuments.delete(doc);
        this.dispatchEvent(new CustomEvent('update-open-documents'));
    }

    async saveDocument(id: string, doc: Document): Promise<void> {
        this.documents.set(id, { doc: deserialize(serialize(doc)), dateModified: new Date() });
        this.dispatchEvent(new CustomEvent('update-documents'));
    }

    async getRecovery(id: string): Promise<RecoveryState> {
        return structuredClone(this.recovery.get(id) ?? emptyRecovery());
    }

    async updateRecovery(id: string, update: (state: RecoveryState) => RecoveryState) {
        const state = update(structuredClone(this.recovery.get(id) ?? emptyRecovery()));
        this.recovery.set(id, structuredClone(state));
        this.dispatchEvent(new CustomEvent('update-recovery', { detail: id }));
        return state;
    }

    async listStoredWorks(): Promise<StoredWork[]> {
        return [...this.documents].map(([id, { doc, dateModified }]) => ({
            id,
            title: doc.title,
            data: serialize(doc),
            dateModified: dateModified.toISOString(),
            recovery: structuredClone(this.recovery.get(id) ?? emptyRecovery()),
        }));
    }

    async importStoredWorks(works: StoredWork[]) {
        const prepared = works.map((work) => ({ work, doc: deserialize(work.data) }));
        if (prepared.some(({ work }) => this.documents.has(work.id))) {
            throw new Error('An imported work already exists.');
        }
        for (const { work, doc } of prepared) {
            this.documents.set(work.id, { doc, dateModified: new Date(work.dateModified) });
            this.recovery.set(work.id, structuredClone(work.recovery));
            this.openDocuments.add(work.id);
        }
        this.dispatchEvent(new CustomEvent('update-documents'));
        this.dispatchEvent(new CustomEvent('update-open-documents'));
    }
}

export function recordCheckpoint(
    storage: IStorage,
    id: string,
    source: string,
    elapsedMs = 0,
    forceFull = false
) {
    return storage.updateRecovery(id, (state) =>
        state.enabled || forceFull ? appendCheckpoint(state, source, elapsedMs, forceFull) : state
    );
}
