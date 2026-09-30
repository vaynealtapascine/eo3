import { fnv1a36 } from '../util/hash';

export const CHECKPOINT_INTERVAL = 60_000;
export const SNAPSHOT_INTERVAL = 600_000;
export const MAX_CHECKPOINTS = 120;
export const MAX_CHECKPOINT_BYTES = 20 * 1024 * 1024;

export interface TextDiff {
    start: number;
    remove: number;
    insert: string;
    beforeHash: string;
}

export type Checkpoint = {
    id: string;
    at: string;
    activeMs: number;
    hash: string;
} & ({ kind: 'snapshot'; data: string } | { kind: 'diff'; data: TextDiff });

export interface RecoveryState {
    enabled: boolean;
    activeMs: number;
    snapshotAt: number;
    entries: Checkpoint[];
}

export const emptyRecovery = (): RecoveryState => ({
    enabled: false,
    activeMs: 0,
    snapshotAt: 0,
    entries: [],
});

/** A replacement of the changed span; unchanged prefixes and suffixes are never stored again. */
export function textDiff(before: string, after: string): TextDiff {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = 0;
    while (
        end < before.length - start &&
        end < after.length - start &&
        before[before.length - end - 1] === after[after.length - end - 1]
    )
        end++;
    return {
        start,
        remove: before.length - start - end,
        insert: after.slice(start, after.length - end),
        beforeHash: fnv1a36(before),
    };
}

export function applyTextDiff(before: string, diff: TextDiff): string {
    if (
        fnv1a36(before) !== diff.beforeHash ||
        !Number.isSafeInteger(diff.start) ||
        !Number.isSafeInteger(diff.remove) ||
        diff.start < 0 ||
        diff.remove < 0 ||
        diff.start + diff.remove > before.length ||
        typeof diff.insert !== 'string'
    )
        throw new Error('This checkpoint has a missing or damaged base.');
    return before.slice(0, diff.start) + diff.insert + before.slice(diff.start + diff.remove);
}

export function checkpointSource(state: RecoveryState, id: string): string {
    const end = state.entries.findIndex((entry) => entry.id === id);
    if (end < 0) throw new Error('This checkpoint is no longer available.');
    let start = end;
    while (start >= 0 && state.entries[start].kind !== 'snapshot') start--;
    if (start < 0) throw new Error('This checkpoint has no full snapshot.');
    let source = '';
    for (let i = start; i <= end; i++) {
        const entry = state.entries[i];
        source = entry.kind === 'snapshot' ? entry.data : applyTextDiff(source, entry.data);
        if (fnv1a36(source) !== entry.hash) throw new Error('This checkpoint is damaged.');
    }
    return source;
}

/** Rebase the first retained diff before pruning, so every retained revision remains recoverable. */
function bounded(state: RecoveryState): RecoveryState {
    const entries = state.entries.slice();
    let bytes = new TextEncoder().encode(JSON.stringify(entries)).length;
    let removed = 0;
    let source = entries.length ? checkpointSource(state, entries[0].id) : '';
    while (
        entries.length - removed > 1 &&
        (entries.length - removed > MAX_CHECKPOINTS || bytes > MAX_CHECKPOINT_BYTES)
    ) {
        bytes -= new TextEncoder().encode(JSON.stringify(entries[removed])).length;
        removed++;
        const next = entries[removed];
        source = next.kind === 'snapshot' ? next.data : applyTextDiff(source, next.data);
        if (next.kind === 'diff') {
            bytes +=
                new TextEncoder().encode(JSON.stringify(source)).length -
                new TextEncoder().encode(JSON.stringify(next.data)).length;
            entries[removed] = { ...next, kind: 'snapshot', data: source };
        }
    }
    return { ...state, entries: entries.slice(removed) };
}

export function appendCheckpoint(
    state: RecoveryState,
    source: string,
    elapsedMs = 0,
    forceFull = false,
    at = new Date().toISOString()
): RecoveryState {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Invalid active-work time.');
    const activeMs = state.activeMs + elapsedMs;
    const last = state.entries.at(-1);
    const before = last ? checkpointSource(state, last.id) : '';
    const fullDue =
        !last ||
        forceFull ||
        Math.floor(activeMs / SNAPSHOT_INTERVAL) > Math.floor(state.snapshotAt / SNAPSHOT_INTERVAL);
    if (!fullDue && source === before) return { ...state, activeMs };
    const diff = textDiff(before, source);
    const full = fullDue || JSON.stringify(diff).length >= source.length;
    const entry: Checkpoint = {
        id: crypto.randomUUID(),
        at,
        activeMs,
        hash: fnv1a36(source),
        ...(full
            ? { kind: 'snapshot' as const, data: source }
            : { kind: 'diff' as const, data: diff }),
    };
    return bounded({
        ...state,
        activeMs,
        snapshotAt: full ? activeMs : state.snapshotAt,
        entries: [...state.entries, entry],
    });
}

/** Counts visible editing time only, with a one-minute idle cutoff and no background catch-up. */
export class ActiveWorkClock {
    private lastTick: number;
    private lastActivity = -Infinity;
    pendingMs = 0;
    constructor(now: number) {
        this.lastTick = now;
    }
    tick(now: number, active: boolean) {
        if (active)
            this.pendingMs += Math.max(
                0,
                Math.min(now, this.lastActivity + CHECKPOINT_INTERVAL) -
                    Math.max(this.lastTick, now - 5000)
            );
        this.lastTick = now;
    }
    activity(now: number, active: boolean) {
        this.tick(now, active);
        if (active) this.lastActivity = now;
    }
    reset(now: number) {
        this.pendingMs = 0;
        this.lastTick = now;
        this.lastActivity = -Infinity;
    }
}
