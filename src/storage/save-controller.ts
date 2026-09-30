import { Document } from '../document';
import { deserialize, IStorage, recordCheckpoint, serialize } from './index';
import {
    ActiveWorkClock,
    appendCheckpoint,
    checkpointSource,
    CHECKPOINT_INTERVAL,
    emptyRecovery,
    RecoveryState,
} from './checkpoints';

export interface SaveState {
    status: 'unsaved' | 'pending' | 'saving' | 'saved' | 'error';
    error: string | null;
    recoveryError: string | null;
    recovery: RecoveryState;
}

/** One ordered writer per open work; edits made during a save always get another save. */
export class SaveController {
    state: SaveState;
    private queue: Promise<unknown> = Promise.resolve();
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    private timer: ReturnType<typeof setInterval>;
    private generation = 0;
    private dirty = false;
    private disposed = false;
    private cancelled = false;
    private checkpointPending = false;
    private clock = new ActiveWorkClock(Date.now());
    readonly ready: Promise<void>;

    constructor(
        private storage: IStorage,
        private id: string,
        private document: Document,
        private options: {
            persisted: boolean;
            isActive(): boolean;
            onState(state: SaveState): void;
            onSaved?(): void;
        }
    ) {
        this.state = {
            status: options.persisted ? 'saved' : 'unsaved',
            error: null,
            recoveryError: null,
            recovery: emptyRecovery(),
        };
        this.ready = storage
            .getRecovery(id)
            .then((recovery) => {
                this.publish({ recovery });
            })
            .catch((error) => {
                this.publish({ recoveryError: String(error) });
            });
        document.addEventListener('change', this.changed);
        storage.addEventListener('delete-document', this.deleted);
        this.timer = setInterval(() => this.tick(), 1000);
    }

    private publish(update: Partial<SaveState>) {
        this.state = { ...this.state, ...update };
        if (!this.disposed) this.options.onState(this.state);
    }

    private ordered<T>(job: () => Promise<T>): Promise<T> {
        const result = this.queue.then(job);
        this.queue = result.catch(() => {});
        return result;
    }

    activity = () => {
        if (this.state.recovery.enabled) this.clock.activity(Date.now(), this.options.isActive());
    };

    private changed = () => {
        this.generation++;
        this.dirty = true;
        this.activity();
        // Keep an existing save error visible until a successful retry.
        if (!this.state.error) this.publish({ status: 'pending' });
        if (!this.saveTimer)
            this.saveTimer = setTimeout(() => {
                this.saveTimer = undefined;
                void this.flush().catch(() => {});
            }, 1000);
    };

    private deleted = (event: Event) => {
        if ((event as CustomEvent<string>).detail !== this.id) return;
        this.cancelled = true;
        this.dirty = false;
        this.clock.reset(Date.now());
        this.dispose();
    };

    flush = (): Promise<void> => {
        clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        return this.ordered(async () => {
            // Drain edits made during writes before resolving: close-tab callers depend on this.
            while (!this.cancelled && this.dirty) {
                const generation = this.generation;
                this.publish({ status: 'saving' });
                try {
                    const snapshot = deserialize(serialize(this.document));
                    await this.storage.saveDocument(this.id, snapshot);
                    if (generation === this.generation) this.dirty = false;
                    this.publish({ status: this.dirty ? 'pending' : 'saved', error: null });
                    if (!this.disposed && !this.dirty) this.options.onSaved?.();
                } catch (error) {
                    this.publish({
                        status: 'error',
                        error: `Couldn’t save this work: ${String(error)}`,
                    });
                    throw error;
                }
            }
        });
    };

    tick = () => {
        this.clock.tick(Date.now(), this.state.recovery.enabled && this.options.isActive());
        const remaining =
            CHECKPOINT_INTERVAL - (this.state.recovery.activeMs % CHECKPOINT_INTERVAL);
        if (this.clock.pendingMs >= remaining && !this.checkpointPending) {
            void this.checkpoint().catch(() => {});
        }
    };

    /** Persist partial active time on tab/page boundaries too, without creating an extra diff. */
    checkpoint = (boundary = false): Promise<void> => {
        if (this.checkpointPending) return this.queue.then(() => {});
        this.checkpointPending = true;
        return this.ordered(async () => {
            await this.ready;
            if (this.cancelled || !this.state.recovery.enabled) return;
            const elapsed = this.clock.pendingMs;
            if (!elapsed) return;
            const due =
                elapsed >=
                CHECKPOINT_INTERVAL - (this.state.recovery.activeMs % CHECKPOINT_INTERVAL);
            try {
                const source = serialize(this.document);
                const recovery = due
                    ? await recordCheckpoint(this.storage, this.id, source, elapsed)
                    : boundary
                    ? await this.storage.updateRecovery(this.id, (state) => ({
                          ...state,
                          activeMs: state.activeMs + (state.enabled ? elapsed : 0),
                      }))
                    : this.state.recovery;
                if (due || boundary) this.clock.pendingMs -= elapsed;
                this.publish({ recovery, recoveryError: null });
            } catch (error) {
                this.publish({ recoveryError: `Couldn’t save checkpoints: ${String(error)}` });
                throw error;
            }
        }).finally(() => {
            this.checkpointPending = false;
        });
    };

    setEnabled = (enabled: boolean): Promise<void> =>
        this.ordered(async () => {
            await this.ready;
            if (this.cancelled) throw new Error('This work was deleted.');
            const source = serialize(this.document);
            const recovery = await this.storage.updateRecovery(this.id, (state) => {
                const updated = { ...state, enabled };
                return enabled ? appendCheckpoint(updated, source, 0, true) : updated;
            });
            this.clock.reset(Date.now());
            if (enabled) {
                this.dirty = true;
                this.generation++;
                this.publish({ status: 'pending' });
            }
            this.publish({ recovery, recoveryError: null });
        });

    restore = (checkpointId: string): Promise<void> =>
        this.ordered(async () => {
            if (this.cancelled) throw new Error('This work was deleted.');
            const recovery = await this.storage.getRecovery(this.id);
            const source = checkpointSource(recovery, checkpointId);
            const restored = deserialize(source);
            // Capture both sides before changing the live document; failed history writes leave it alone.
            const saved = await this.storage.updateRecovery(this.id, (state) => {
                const before = appendCheckpoint(state, serialize(this.document), 0, true);
                return appendCheckpoint(before, source, 0, true);
            });
            this.document.loadFrom(restored); // Undoable; the change listener schedules autosave.
            this.publish({ recovery: saved, recoveryError: null });
        });

    refreshRecovery = async () => {
        const recovery = await this.storage.getRecovery(this.id);
        this.publish({ recovery, recoveryError: null });
    };

    clearHistory = (): Promise<void> =>
        this.ordered(async () => {
            if (this.cancelled) throw new Error('This work was deleted.');
            const source = serialize(this.document);
            const recovery = await this.storage.updateRecovery(this.id, (state) =>
                state.enabled
                    ? appendCheckpoint({ ...emptyRecovery(), enabled: true }, source, 0, true)
                    : emptyRecovery()
            );
            this.clock.reset(Date.now());
            this.publish({ recovery, recoveryError: null });
        });

    dispose() {
        if (this.disposed) return;
        this.tick();
        this.disposed = true;
        this.document.removeEventListener('change', this.changed);
        this.storage.removeEventListener('delete-document', this.deleted);
        clearInterval(this.timer);
        // Start the save even when closing an editor tab; never leave the pending timer behind.
        void this.flush().catch(() => {});
        void this.checkpoint(true).catch(() => {});
    }
}
