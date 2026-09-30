import { describe, expect, it } from 'vitest';
import {
    ActiveWorkClock,
    appendCheckpoint,
    applyTextDiff,
    checkpointSource,
    emptyRecovery,
    MAX_CHECKPOINTS,
    textDiff,
} from '../../src/storage/checkpoints';

describe('incremental checkpoint history', () => {
    it.each([
        ['', ''],
        ['', 'hello'],
        ['hello', ''],
        ['same', 'same'],
        ['one middle end', 'one changed end'],
        ['💜 café\r\nend', '💜 中文\r\nend'],
    ])('round-trips changed text (%j -> %j)', (before, after) => {
        expect(applyTextDiff(before, textDiff(before, after))).toBe(after);
    });

    it('stores small changes and full snapshots at ten active minutes', () => {
        const prefix = 'unchanged writing '.repeat(100);
        let state = appendCheckpoint({ ...emptyRecovery(), enabled: true }, prefix + '0');
        for (let minute = 1; minute <= 10; minute++) {
            state = appendCheckpoint(state, prefix + minute, 60_000);
            expect(state.entries.at(-1)?.kind).toBe(minute === 10 ? 'snapshot' : 'diff');
        }
        for (let minute = 0; minute <= 10; minute++)
            expect(checkpointSource(state, state.entries[minute].id)).toBe(prefix + minute);
    });

    it('skips unchanged diffs but keeps the ten-minute full snapshot', () => {
        let state = appendCheckpoint(emptyRecovery(), 'unchanged '.repeat(100));
        const original = state.entries[0];
        for (let minute = 1; minute <= 9; minute++)
            state = appendCheckpoint(state, original.data as string, 60_000);
        expect(state.entries).toEqual([original]);
        state = appendCheckpoint(state, original.data as string, 60_000);
        expect(state.entries).toHaveLength(2);
        expect(state.entries[1].kind).toBe('snapshot');
    });

    it('rebases retained history rather than leaving diffs with deleted bases', () => {
        const prefix = 'very long unchanged chapter '.repeat(100);
        let state = appendCheckpoint(emptyRecovery(), prefix + '0');
        for (let minute = 1; minute <= MAX_CHECKPOINTS + 30; minute++)
            state = appendCheckpoint(state, prefix + minute, 60_000);
        expect(state.entries).toHaveLength(MAX_CHECKPOINTS);
        expect(state.entries[0].kind).toBe('snapshot');
        for (const entry of state.entries)
            expect(checkpointSource(state, entry.id)).toBe(prefix + entry.activeMs / 60_000);
    });

    it('rejects damaged bases, results and unavailable revisions', () => {
        const source = 'chapter '.repeat(100);
        const before = appendCheckpoint(emptyRecovery(), source);
        const state = appendCheckpoint(before, source + 'edit', 60_000);
        expect(() => applyTextDiff('different', textDiff(source, 'edit'))).toThrow('damaged base');
        expect(() => applyTextDiff(source, { ...textDiff(source, 'edit'), remove: -1 })).toThrow();
        expect(() => checkpointSource(state, 'missing')).toThrow('no longer available');
        state.entries[1].hash = 'broken';
        expect(() => checkpointSource(state, state.entries[1].id)).toThrow('damaged');
    });

    it('keeps ten-minute boundaries even when an earlier full snapshot was cheaper', () => {
        let state = appendCheckpoint(emptyRecovery(), 'tiny');
        state = appendCheckpoint(state, 'different', 540_000);
        expect(state.entries.at(-1)?.kind).toBe('snapshot');
        state = appendCheckpoint(state, 'different', 60_000);
        expect(state.entries.at(-1)?.kind).toBe('snapshot');
        expect(state.entries.at(-1)?.activeMs).toBe(600_000);
    });

    it('bounds byte retention and always keeps the latest recoverable snapshot', () => {
        const large = 'x'.repeat(11 * 1024 * 1024);
        let state = appendCheckpoint(emptyRecovery(), large);
        state = appendCheckpoint(state, large + ' latest', 60_000, true);
        expect(state.entries).toHaveLength(1);
        expect(checkpointSource(state, state.entries[0].id)).toBe(large + ' latest');
    });
});

describe('active-work clock', () => {
    it('counts editing, stops at the idle cutoff and ignores hidden/unfocused intervals', () => {
        const clock = new ActiveWorkClock(0);
        clock.tick(1000, true);
        expect(clock.pendingMs).toBe(0);
        clock.activity(1000, true);
        for (let second = 2; second <= 100; second++) clock.tick(second * 1000, true);
        expect(clock.pendingMs).toBe(60_000);
        clock.activity(100_000, false);
        for (let second = 101; second <= 150; second++) clock.tick(second * 1000, false);
        expect(clock.pendingMs).toBe(60_000);
        clock.activity(150_000, true);
        clock.tick(151_000, true);
        expect(clock.pendingMs).toBe(61_000);
    });

    it('does not count a long suspended timer as active work', () => {
        const clock = new ActiveWorkClock(0);
        clock.activity(0, true);
        clock.tick(300_000, true);
        expect(clock.pendingMs).toBe(0);
    });
});
