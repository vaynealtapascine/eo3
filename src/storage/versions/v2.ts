import { IDBPDatabase } from 'idb';
import { RecoveryState } from '../checkpoints';
import { SchemaV1 } from './v1';

/** Database version only: saved document files remain version 1. */
export interface SchemaV2 extends SchemaV1 {
    recovery: { key: string; value: RecoveryState };
}

export function migrateV2(db: IDBPDatabase<SchemaV2>) {
    db.createObjectStore('recovery');
}
