export type SvelteModules = Map<string, { contents: string }>;
export type SvelteVersion = 'legacy' | 'v4' | 'v5';

export const SVELTE_STARTUP_TIMEOUT_MS = 30_000;
export const SVELTE_BUNDLE_TIMEOUT_MS = 15_000;
const TIMEOUT_RETRIES = 2;

class BundlerTimeout extends Error {
    constructor(phase: 'startup' | 'bundle') {
        super(
            phase === 'startup' ? 'Svelte: worker startup timed out' : 'Svelte: bundler timed out'
        );
    }
}

type PendingBundle = {
    resolve: (result: string) => void;
    reject: (error: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
};

type WorkerSession = {
    worker: Worker;
    ready: Promise<void>;
    resolveReady: () => void;
    rejectReady: (error: Error) => void;
    started: boolean;
    failure?: Error;
    startupTimer?: ReturnType<typeof setTimeout>;
    pending: Map<string, PendingBundle>;
    onMessage: (event: MessageEvent) => void;
    onError: (event: ErrorEvent) => void;
    onMessageError: () => void;
};

/** One shared worker, with separate startup and compilation deadlines. */
export class SvelteBundler {
    private session: WorkerSession | null = null;
    private nextMessageId = 0;

    constructor(private createWorker: () => Worker) {}

    async bundle(
        modules: SvelteModules,
        main: string,
        mainId: string,
        version: SvelteVersion
    ): Promise<string> {
        for (let attempt = 0; ; attempt++) {
            try {
                const session = this.getSession();
                await session.ready;
                // Another request may have failed this worker while we awaited readiness.
                if (session.failure) throw session.failure;
                return await this.request(session, { modules, main, mainId, version });
            } catch (error) {
                // Syntax/import errors and worker crashes should surface immediately.
                if (!(error instanceof BundlerTimeout) || attempt >= TIMEOUT_RETRIES) throw error;
            }
        }
    }

    private getSession(): WorkerSession {
        if (this.session) return this.session;
        let resolveReady!: () => void;
        let rejectReady!: (error: Error) => void;
        const ready = new Promise<void>((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        const session: WorkerSession = {
            worker: this.createWorker(),
            ready,
            resolveReady,
            rejectReady,
            started: false,
            pending: new Map(),
            onMessage: (event) => {
                const response = event.data;
                if (response?.type === 'ready') {
                    session.started = true;
                    clearTimeout(session.startupTimer);
                    session.resolveReady();
                    return;
                }
                const request = session.pending.get(response?.id);
                if (!request) return;
                session.pending.delete(response.id);
                clearTimeout(request.timer);
                if (response.success) request.resolve(response.result);
                else request.reject(new Error(response.error));
            },
            onError: (event) =>
                this.failSession(session, new Error(event.message || 'Error in Svelte worker')),
            onMessageError: () =>
                this.failSession(session, new Error('Could not read a message from Svelte worker')),
        };
        this.session = session;
        session.worker.addEventListener('message', session.onMessage);
        session.worker.addEventListener('error', session.onError);
        session.worker.addEventListener('messageerror', session.onMessageError);
        session.startupTimer = setTimeout(
            () => this.failSession(session, new BundlerTimeout('startup')),
            SVELTE_STARTUP_TIMEOUT_MS
        );
        return session;
    }

    private request(
        session: WorkerSession,
        payload: { modules: SvelteModules; main: string; mainId: string; version: SvelteVersion }
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const id = `svelte:${++this.nextMessageId}`;
            const timer = setTimeout(
                () => this.failSession(session, new BundlerTimeout('bundle')),
                SVELTE_BUNDLE_TIMEOUT_MS
            );
            session.pending.set(id, { resolve, reject, timer });
            try {
                session.worker.postMessage({ id, type: 'bundle', ...payload });
            } catch (error) {
                session.pending.delete(id);
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    private failSession(session: WorkerSession, error: Error) {
        if (session.failure) return;
        session.failure = error;
        // A callback belonging to an old worker must never terminate its replacement.
        if (this.session === session) this.session = null;
        clearTimeout(session.startupTimer);
        session.worker.removeEventListener('message', session.onMessage);
        session.worker.removeEventListener('error', session.onError);
        session.worker.removeEventListener('messageerror', session.onMessageError);
        session.worker.terminate();
        if (!session.started) session.rejectReady(error);
        for (const request of session.pending.values()) {
            clearTimeout(request.timer);
            request.reject(error);
        }
        session.pending.clear();
    }
}
