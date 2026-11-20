/**
 * Verifies the published entry page as well as /about: a stale CDN page can
 * reference deleted chunks even when wrangler deploy reports success.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const origin = (process.argv[2] || 'https://eo3.dev').replace(/\/$/, '');
const expected = await readFile('dist/index.html');
const sha1 = (body) => createHash('sha1').update(body).digest('hex');
const expectedHash = sha1(expected);

for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) await delay(15_000);
    const response = await fetch(`${origin}/`, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(30_000),
    });
    const actualHash = sha1(Buffer.from(await response.arrayBuffer()));
    if (response.ok && actualHash === expectedHash) {
        const aboutRes = await fetch(`${origin}/about/`, {
            headers: { 'Cache-Control': 'no-cache' },
            signal: AbortSignal.timeout(30_000),
        });
        if (!aboutRes.ok) {
            throw new Error(`Expected ${origin}/about/ to return 200, got HTTP ${aboutRes.status}`);
        }
        console.log(`Live EO3 entry and /about/ verified at ${origin}/`);
        process.exit(0);
    }
    console.log(
        `Live EO3 entry attempt ${attempt + 1}: HTTP ${
            response.status
        }, SHA-1 ${actualHash}, modified ${response.headers.get(
            'last-modified'
        )}, cache ${response.headers.get('cf-cache-status')}`
    );
}

throw new Error(
    'The uploaded EO3 entry is current, but the public entry page is still stale. Check the Cloudflare cache before treating this deployment as live.'
);
