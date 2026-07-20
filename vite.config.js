import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import childProcess from 'node:child_process';
import { defineConfig } from 'vite';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const prod = process.env.NODE_ENV === 'production';

const CONFIG = {
    staticUrlPrefix: process.env.EO3_STATIC || 'https://ao3.org/static/',
    cohostStaticUrlPrefix: process.env.EO3_COHOST_STATIC || 'https://cohost.org/static/',
    gitCommitHash:
        process.env.EO3_GIT_COMMIT_HASH?.substring(0, 7) ||
        childProcess
            .execSync('git rev-parse --short HEAD', {
                cwd: __dirname,
                encoding: 'utf-8',
            })
            .trim(),
};

console.error(`\x1b[32mUsing EO3_STATIC=${CONFIG.staticUrlPrefix}\x1b[m`);
if (CONFIG.staticUrlPrefix.includes('//archiveofourown.org')) {
    console.error('\x1b[31m+------------------------------------------------+\x1b[m');
    console.error('\x1b[31m|   loading assets directly from ao3 dot org!!!  |\x1b[m');
    console.error('\x1b[31m|           links may be unreliable...           |\x1b[m');
    console.error('\x1b[31m+------------------------------------------------+\x1b[m');
}

console.error(`\x1b[32mUsing EO3_COHOST_STATIC=${CONFIG.cohostStaticUrlPrefix}\x1b[m`);
console.error(
    '\x1b[33m| cohost shut down in Jan 2025 — the live cohost renderer will only work\x1b[m'
);
console.error(
    '\x1b[33m| if EO3_COHOST_STATIC points at a preserved mirror of its static assets.\x1b[m'
);

export default defineConfig({
    base: './',
    plugins: [
        react(),
        stringNodeModules(),
        bundledNodeModules(),
        svelteV5RuntimeTree(),
        config(),
        hackToFixSvelteWebWorker(),
    ],
    build: {
        rollupOptions: {
            // i dont know why but some of these need to be repeated here for some reason
            plugins: [
                stringNodeModules(),
                bundledNodeModules(),
                svelteV5RuntimeTree(),
                hackToFixSvelteWebWorker(),
            ],
        },
        sourcemap: true,
    },
});

function readFileAsModule(id) {
    return new Promise((resolve, reject) => {
        fs.readFile(id, 'utf-8', (err, file) => {
            if (err) reject(err);
            else {
                resolve(`export default ${JSON.stringify(file)};`);
            }
        });
    });
}

function stringNodeModules() {
    // don't let vite catch on that we're importing something from node modules
    const scheme = 'string-node-modules:';

    return {
        name: 'string-node-modules',
        resolveId(id, importer) {
            if (id.startsWith(scheme)) {
                return '\0' + id;
            }
            return null;
        },
        load(id) {
            if (id.startsWith('\0' + scheme)) {
                return readFileAsModule(
                    __dirname + '/node_modules/' + id.substring(scheme.length + 1)
                );
            }
            return null;
        },
    };
}

/**
 * Some node_modules (svelte-v4, svelte-v5) ship as multi-file source trees rather
 * than svelte-legacy's pre-bundled single files, so `stringNodeModules()`'s
 * single-file-read trick can't inline them directly. This runs a real Rollup
 * build over the given entry point at our own build time and inlines the
 * flattened, single-file result as a string instead.
 */
function bundledNodeModules() {
    const scheme = 'bundled-node-module:';
    const cache = new Map();

    async function bundleEntry(entry) {
        const bundle = await rollup({
            input: entry,
            plugins: [
                nodeResolve({
                    browser: true,
                    exportConditions: ['browser', 'development', 'import', 'default'],
                }),
                commonjs(),
            ],
        });
        try {
            const { output } = await bundle.generate({ format: 'es' });
            return `export default ${JSON.stringify(output[0].code)};`;
        } finally {
            await bundle.close();
        }
    }

    return {
        name: 'bundled-node-module',
        resolveId(id) {
            if (id.startsWith(scheme)) {
                return '\0' + id;
            }
            return null;
        },
        load(id) {
            if (id.startsWith('\0' + scheme)) {
                const entry = id.substring(('\0' + scheme).length);
                if (!cache.has(entry)) {
                    cache.set(entry, bundleEntry(entry));
                }
                return cache.get(entry);
            }
            return null;
        },
    };
}

/**
 * Svelte 5's client runtime and its "legacy" (non-runes) component support share
 * mutable module state — specifically `legacy_mode_flag` in svelte-v5/src/internal/flags/index.js,
 * which gates whether legacy-style `export let`/`$:` components actually behave
 * correctly independently. Instead this bundles all four together with Rollup's
 * `preserveModules`, so cross-references between them resolve to the exact same
 * underlying module instances.
 */
function svelteV5RuntimeTree() {
    const id = 'svelte-v5-runtime-tree:group';
    let cached;

    async function build() {
        const bundle = await rollup({
            input: {
                main: 'svelte-v5',
                client: 'svelte-v5/internal/client',
                disclose: 'svelte-v5/internal/disclose-version',
                legacyFlag: 'svelte-v5/internal/flags/legacy',
            },
            plugins: [
                nodeResolve({
                    browser: true,
                    exportConditions: ['browser', 'development', 'import', 'default'],
                }),
                commonjs(),
            ],
            // preserveModules keeps svelte-v5's own file boundaries, surfacing
            // the cycles inherent to its internal reactivity. Those are expected
            // and harmless under ESM live bindings, so silencing it here.
            onwarn(warning, warn) {
                if (warning.code === 'CIRCULAR_DEPENDENCY') return;
                warn(warning);
            },
        });
        try {
            const { output } = await bundle.generate({ format: 'es', preserveModules: true });
            const files = {};
            const entries = {};
            for (const chunk of output) {
                if (chunk.type !== 'chunk') continue;
                files[chunk.fileName] = chunk.code;
                if (chunk.isEntry) entries[chunk.name] = chunk.fileName;
            }
            return `export default ${JSON.stringify({ files, entries })};`;
        } finally {
            await bundle.close();
        }
    }

    return {
        name: 'svelte-v5-runtime-tree',
        resolveId(requestedId) {
            if (requestedId === id) {
                return '\0' + id;
            }
            return null;
        },
        load(requestedId) {
            if (requestedId === '\0' + id) {
                if (!cached) {
                    cached = build();
                }
                return cached;
            }
            return null;
        },
    };
}

/** load build config from js */
function config() {
    const scheme = 'eo3:';

    return {
        name: 'config',
        resolveId(id, importer) {
            if (id.startsWith(scheme)) {
                return '\0' + id;
            }
            return null;
        },
        load(id) {
            if (id.startsWith('\0' + scheme)) {
                const k = id.substring(scheme.length + 1);
                if (k === 'config') {
                    return Object.keys(CONFIG)
                        .map((k) => `export const ${k} = ${JSON.stringify(CONFIG[k])};`)
                        .join('\n');
                }
            }
            return null;
        },
    };
}

/** Fix svelte's incorrect use of `window`, which does not exist in web workers */
function hackToFixSvelteWebWorker() {
    return {
        transform(code, id) {
            if (id.includes('svelte/') || id.match(/node_modules.+svelte/)) {
                return { code: code.replace(/\bwindow\b/g, 'globalThis'), map: null };
            }
            return null;
        },
        enforce: 'post',
    };
}
