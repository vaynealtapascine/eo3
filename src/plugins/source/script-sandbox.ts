import type { ScriptResult } from './script-runtime';

/**
 * Runs programs from `buildScriptProgram` away from eo3's own page: in a hidden iframe with an
 * opaque origin (`sandbox="allow-scripts"`, so no access to the library in IndexedDB or to this
 * page), inside a Worker the iframe makes, so a script that never ends can be stopped. Where a
 * browser won't start a worker there, the program runs in the iframe itself.
 */

export const SCRIPT_TIMEOUT_MS = 5000;

const RUNNER = `<!doctype html>
<meta charset="utf-8">
<script>
function run(id, program, timeout) {
    let done = false;
    let worker = null;
    let url = null;
    const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (worker) worker.terminate();
        if (url) URL.revokeObjectURL(url);
        parent.postMessage({ type: 'eo3-script-result', id, result }, '*');
    };
    const timer = setTimeout(() => finish({
        ok: false,
        error: 'The script ran for more than ' + timeout / 1000 + ' seconds, so it was stopped. Check for a loop that never ends.',
    }), timeout);
    try {
        url = URL.createObjectURL(new Blob(['const __eo3Done = (result) => postMessage(result);\\n' + program], { type: 'text/javascript' }));
        worker = new Worker(url);
        worker.onmessage = (e) => finish(e.data);
        worker.onerror = (e) => {
            e.preventDefault();
            finish({ ok: false, error: e.message || 'The script could not be run.' });
        };
    } catch (err) {
        worker = null;
        try {
            new Function('__eo3Done', program)(finish);
        } catch (err) {
            finish({ ok: false, error: String(err && err.message || err) });
        }
    }
}
addEventListener('message', (e) => {
    if (e.source === parent && e.data && e.data.type === 'eo3-run-script') {
        run(e.data.id, e.data.program, e.data.timeout);
    }
});
parent.postMessage({ type: 'eo3-script-sandbox-ready' }, '*');
</script>`;

type Pending = { resolve: (result: ScriptResult) => void; timer: ReturnType<typeof setTimeout> };

let frame: HTMLIFrameElement | null = null;
let ready: Promise<Window> | null = null;
const pending = new Map<string, Pending>();
let nextId = 0;

function onMessage(event: MessageEvent) {
    if (!frame || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (data?.type !== 'eo3-script-result') return;
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    request.resolve(data.result as ScriptResult);
}

function sandbox(): Promise<Window> {
    if (frame && ready && frame.isConnected) return ready;
    frame?.remove();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.title = 'Script sandbox';
    iframe.className = 'script-execution-sandbox';
    Object.assign(iframe.style, {
        position: 'fixed',
        top: '0',
        left: '-1000px',
        width: '1px',
        height: '1px',
        border: '0',
    });
    frame = iframe;
    ready = new Promise((resolve, reject) => {
        const onReady = (event: MessageEvent) => {
            if (event.source !== iframe.contentWindow) return;
            if (event.data?.type !== 'eo3-script-sandbox-ready') return;
            window.removeEventListener('message', onReady);
            clearTimeout(timer);
            resolve(iframe.contentWindow!);
        };
        const timer = setTimeout(() => {
            window.removeEventListener('message', onReady);
            if (frame === iframe) {
                frame = null;
                ready = null;
            }
            iframe.remove();
            reject(new Error('The script sandbox did not start.'));
        }, 10_000);
        window.addEventListener('message', onReady);
    });
    window.removeEventListener('message', onMessage);
    window.addEventListener('message', onMessage);
    iframe.srcdoc = RUNNER;
    document.body.append(iframe);
    return ready;
}

/** Runs a program from `buildScriptProgram` in the sandbox. */
export async function runScript(
    program: string,
    timeoutMs = SCRIPT_TIMEOUT_MS
): Promise<ScriptResult> {
    const target = await sandbox();
    const id = `script:${++nextId}`;
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            // The runner stops scripts itself; this only fires if the sandbox stopped answering.
            pending.delete(id);
            frame?.remove();
            frame = null;
            ready = null;
            resolve({ ok: false, error: 'The script sandbox stopped responding.' });
        }, timeoutMs + 5000);
        pending.set(id, { resolve, timer });
        target.postMessage({ type: 'eo3-run-script', id, program, timeout: timeoutMs }, '*');
    });
}
