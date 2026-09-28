import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SvelteBundler,
    SVELTE_BUNDLE_TIMEOUT_MS,
    SVELTE_STARTUP_TIMEOUT_MS,
} from '../../src/plugins/source/svelte-bundler';

type Request = { id: string; mainId: string; modules: Map<string, { contents: string }> };

class FakeWorker extends EventTarget {
    messages: Request[] = [];
    failPost = false;
    terminate = vi.fn();

    postMessage(request: Request) {
        if (this.failPost) throw new Error('Could not clone request');
        this.messages.push(request);
    }

    ready() {
        this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }));
    }

    reply(index: number, result: string, success = true) {
        this.dispatchEvent(
            new MessageEvent('message', {
                data: { id: this.messages[index].id, success, result, error: result },
            })
        );
    }

    crash(message = 'Worker could not load') {
        this.dispatchEvent(new ErrorEvent('error', { message }));
    }
}

function harness() {
    const workers: FakeWorker[] = [];
    const create = vi.fn(() => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
    });
    const bundler = new SvelteBundler(create);
    const modules = new Map([['Main.svelte', { contents: '<p>Lorem ipsum.</p>' }]]);
    const bundle = (name = 'Main') => bundler.bundle(modules, 'Main.svelte', name, 'v4');
    return { workers, create, modules, bundle };
}

describe('Svelte worker lifecycle and timeout recovery', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('waits for a slow cold startup before starting the compilation deadline, then reuses the worker', async () => {
        const { bundle, workers, create } = harness();
        const result = bundle();
        await vi.advanceTimersByTimeAsync(6_500);
        expect(workers).toHaveLength(1);
        expect(workers[0].messages).toHaveLength(0);
        expect(workers[0].terminate).not.toHaveBeenCalled();
        workers[0].ready();
        await vi.advanceTimersByTimeAsync(0);
        workers[0].reply(0, 'first bundle');
        await expect(result).resolves.toBe('first bundle');
        expect(vi.getTimerCount()).toBe(0);

        const next = bundle();
        await vi.advanceTimersByTimeAsync(0);
        workers[0].reply(1, 'next bundle');
        await expect(next).resolves.toBe('next bundle');
        expect(create).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retries compilation timeouts twice and ignores events from retired workers', async () => {
        const { bundle, workers, modules } = harness();
        const result = bundle();
        for (let attempt = 0; attempt < 2; attempt++) {
            workers[attempt].ready();
            await vi.advanceTimersByTimeAsync(0);
            expect(workers[attempt].messages[0].modules).toBe(modules);
            await vi.advanceTimersByTimeAsync(SVELTE_BUNDLE_TIMEOUT_MS);
            expect(workers[attempt].terminate).toHaveBeenCalledTimes(1);
        }
        expect(workers).toHaveLength(3);
        workers[2].ready();
        await vi.advanceTimersByTimeAsync(0);
        workers[0].reply(0, 'stale bundle');
        workers[1].crash('late error');
        workers[2].reply(0, 'recovered bundle');
        await expect(result).resolves.toBe('recovered bundle');
        await vi.advanceTimersByTimeAsync(SVELTE_STARTUP_TIMEOUT_MS);
        expect(workers[2].terminate).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['startup', 'bundle'] as const)(
        'stops after three %s timeouts and clears all timers',
        async (phase) => {
            const { bundle, workers } = harness();
            const result = bundle().catch((error) => error);
            for (let attempt = 0; attempt < 3; attempt++) {
                if (phase === 'bundle') workers[attempt].ready();
                await vi.advanceTimersByTimeAsync(0);
                await vi.advanceTimersByTimeAsync(
                    phase === 'startup' ? SVELTE_STARTUP_TIMEOUT_MS : SVELTE_BUNDLE_TIMEOUT_MS
                );
            }
            expect((await result).message).toBe(
                phase === 'startup'
                    ? 'Svelte: worker startup timed out'
                    : 'Svelte: bundler timed out'
            );
            expect(workers).toHaveLength(3);
            for (const worker of workers) expect(worker.terminate).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        }
    );

    it('recovers when the first two workers never become ready', async () => {
        const { bundle, workers } = harness();
        const result = bundle();
        await vi.advanceTimersByTimeAsync(SVELTE_STARTUP_TIMEOUT_MS * 2);
        expect(workers).toHaveLength(3);
        expect(workers[0].messages).toHaveLength(0);
        expect(workers[1].messages).toHaveLength(0);
        workers[0].ready();
        workers[2].ready();
        await vi.advanceTimersByTimeAsync(0);
        workers[2].reply(0, 'started');
        await expect(result).resolves.toBe('started');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not retry compiler errors or discard a healthy worker', async () => {
        const { bundle, workers, create } = harness();
        const result = bundle().catch((error) => error);
        workers[0].ready();
        await vi.advanceTimersByTimeAsync(0);
        workers[0].reply(0, 'Unexpected token in Main.svelte', false);
        expect((await result).message).toBe('Unexpected token in Main.svelte');
        expect(create).toHaveBeenCalledTimes(1);
        expect(workers[0].terminate).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        const next = bundle();
        await vi.advanceTimersByTimeAsync(0);
        workers[0].reply(1, 'fixed source');
        await expect(next).resolves.toBe('fixed source');
    });

    it('cleans up a startup crash so its old timer cannot kill a later render', async () => {
        const { bundle, workers } = harness();
        const failed = bundle().catch((error) => error);
        await vi.advanceTimersByTimeAsync(1000);
        workers[0].crash();
        expect((await failed).message).toBe('Worker could not load');
        expect(workers).toHaveLength(1);
        const next = bundle();
        workers[1].ready();
        await vi.advanceTimersByTimeAsync(0);
        workers[1].reply(0, 'new worker');
        await expect(next).resolves.toBe('new worker');
        workers[0].crash();
        await vi.advanceTimersByTimeAsync(SVELTE_STARTUP_TIMEOUT_MS);
        expect(workers[1].terminate).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('shares startup and retries all concurrent requests when their worker times out', async () => {
        const { bundle, workers } = harness();
        const first = bundle('First');
        const second = bundle('Second');
        expect(workers).toHaveLength(1);
        workers[0].ready();
        await vi.advanceTimersByTimeAsync(0);
        expect(workers[0].messages).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(SVELTE_BUNDLE_TIMEOUT_MS);
        expect(workers).toHaveLength(2);
        workers[1].ready();
        await vi.advanceTimersByTimeAsync(0);
        expect(workers[1].messages).toHaveLength(2);
        workers[1].reply(1, 'second');
        workers[1].reply(0, 'first');
        await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
        expect(vi.getTimerCount()).toBe(0);
        expect(workers[1].terminate).not.toHaveBeenCalled();
    });

    it('rejects every pending request immediately on a worker crash', async () => {
        const { bundle, workers } = harness();
        const first = bundle().catch((error) => error);
        const second = bundle().catch((error) => error);
        workers[0].ready();
        await vi.advanceTimersByTimeAsync(0);
        workers[0].crash('worker crashed');
        expect((await first).message).toBe('worker crashed');
        expect((await second).message).toBe('worker crashed');
        expect(workers).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cleans up unreadable messages without retrying', async () => {
        const { bundle, workers } = harness();
        const result = bundle().catch((error) => error);
        workers[0].ready();
        await vi.advanceTimersByTimeAsync(0);
        workers[0].dispatchEvent(new MessageEvent('messageerror'));
        expect((await result).message).toBe('Could not read a message from Svelte worker');
        expect(workers).toHaveLength(1);
        expect(workers[0].terminate).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the request deadline when posting fails, leaving the worker reusable', async () => {
        const { bundle, workers } = harness();
        const result = bundle().catch((error) => error);
        workers[0].failPost = true;
        workers[0].ready();
        await vi.advanceTimersByTimeAsync(0);
        expect((await result).message).toBe('Could not clone request');
        expect(workers).toHaveLength(1);
        expect(workers[0].terminate).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        workers[0].failPost = false;
        const next = bundle();
        await vi.advanceTimersByTimeAsync(0);
        workers[0].reply(0, 'posted');
        await expect(next).resolves.toBe('posted');
    });
});
