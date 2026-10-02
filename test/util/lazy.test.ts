import { describe, expect, it, vi } from 'vitest';
import { lazy } from '../../src/util/lazy';

describe('lazy plugin loading', () => {
    it('shares one pending load across concurrent callers and caches falsy exports', async () => {
        let finish!: (value: { default: number }) => void;
        const callback = vi.fn(
            () =>
                new Promise<{ default: number }>((resolve) => {
                    finish = resolve;
                })
        );
        const load = lazy(callback);
        const first = load();
        const second = load();
        await Promise.resolve();
        expect(callback).toHaveBeenCalledTimes(1);
        finish({ default: 0 });
        expect(await Promise.all([first, second, load()])).toEqual([0, 0, 0]);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('lets a failed load be retried', async () => {
        const callback = vi
            .fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue({ default: 'plugin' });
        const load = lazy(callback);
        await expect(load()).rejects.toThrow('offline');
        expect(await load()).toBe('plugin');
        expect(callback).toHaveBeenCalledTimes(2);
    });
});
