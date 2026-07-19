import { compile as compileLegacy } from 'svelte-legacy/compiler';
import { compile as compileV4 } from 'svelte-v4/compiler';
import { compile as compileV5 } from 'svelte-v5/compiler';
import { rollup } from 'rollup/dist/es/rollup.browser.js';
import { URL } from 'whatwg-url'; // chrome’s built-in URL seems to not be spec-compliant

import sSvelteLegacy from 'string-node-modules:svelte-legacy/index.mjs';
import sSvelteLegacyInternal from 'string-node-modules:svelte-legacy/internal/index.mjs';
import sSvelteV4 from 'bundled-node-module:svelte-v4';
import sSvelteV4Internal from 'bundled-node-module:svelte-v4/internal';
import sSvelteV4DiscloseVersion from 'bundled-node-module:svelte-v4/internal/disclose-version';
import svelteV5Runtime from 'svelte-v5-runtime-tree:group';

// synthetic entry module rollup bundles instead of the user's main file directly,
// so a v5 bundle can also export `mount` alongside the component (see ENTRY_URL below)
const ENTRY_URL = 'file:///__eo3_entry__.js';

// svelte-v5's runtime files are registered under this private namespace so their
// own relative cross-references (computed by Rollup's preserveModules) resolve
// consistently; see svelteV5RuntimeTree() in vite.config.js for why they can't be
// bundled independently like svelte-v4's are below.
const V5_TREE_NS = 'lib:///_tree/';

const RUNE_PATTERN = /\$(state|derived|effect|props|bindable|inspect|host)\b/;
const SNIPPET_PATTERN = /\{#snippet\b|\{@render\b/;

function detectSvelte5Syntax(code) {
    return code.match(RUNE_PATTERN)?.[0] ?? code.match(SNIPPET_PATTERN)?.[0] ?? null;
}

const VERSIONS = {
    legacy: {
        label: 'Svelte 3.55.1 (legacy)',
        compile: (code, opts) => compileLegacy(code, opts),
        checkForRunes: true,
        exportsMount: false,
        libraryModules: {
            'lib:///svelte/index.mjs': sSvelteLegacy,
            'lib:///svelte/internal/index.mjs': sSvelteLegacyInternal,
        },
    },
    v4: {
        label: 'Svelte 4',
        compile: (code, opts) => compileV4(code, opts),
        checkForRunes: true,
        exportsMount: false,
        libraryModules: {
            'lib:///svelte/index.mjs': sSvelteV4,
            'lib:///svelte/internal/index.mjs': sSvelteV4Internal,
            'lib:///svelte/internal/disclose-version/index.mjs': sSvelteV4DiscloseVersion,
        },
    },
    v5: {
        label: 'Svelte 5',
        compile: (code, opts) => compileV5(code, { ...opts, generate: 'client' }),
        checkForRunes: false,
        exportsMount: true,
        libraryTree: svelteV5Runtime,
        bareImportAliases: {
            svelte: V5_TREE_NS + svelteV5Runtime.entries.main,
            'svelte/internal/client': V5_TREE_NS + svelteV5Runtime.entries.client,
            'svelte/internal/disclose-version': V5_TREE_NS + svelteV5Runtime.entries.disclose,
            'svelte/internal/flags/legacy': V5_TREE_NS + svelteV5Runtime.entries.legacyFlag,
        },
    },
};

async function bundleModules(modules, main, mainId, version) {
    const versionConfig = VERSIONS[version] || VERSIONS.legacy;

    const index = { ...versionConfig.libraryModules };
    if (versionConfig.libraryTree) {
        for (const [fileName, code] of Object.entries(versionConfig.libraryTree.files)) {
            index[V5_TREE_NS + fileName] = code;
        }
    }
    for (const [k, module] of modules) {
        index[`file:///${k}`] = module.contents;
    }
    index[ENTRY_URL] = versionConfig.exportsMount
        ? `export { default } from './${main}';\nexport { mount } from 'svelte';\n`
        : `export { default } from './${main}';\n`;

    const bundle = await rollup({
        input: ENTRY_URL,
        plugins: [
            {
                resolveId(id, importer) {
                    let url;

                    if (!id.startsWith('.')) {
                        // id doesn't start with ./ or ../ - library path
                        const alias = versionConfig.bareImportAliases?.[id];
                        if (alias) {
                            return alias;
                        }
                        url = new URL(id, 'lib:///');
                    } else {
                        url = new URL(id, importer);
                    }

                    const candidates = [url.href, url.href + '/index.js', url.href + '/index.mjs'];

                    for (const candidate of candidates) {
                        if (candidate in index) {
                            return candidate;
                        }
                    }

                    throw new Error(`Could not resolve ${id} (in ${importer})`);
                },
                load(id) {
                    if (id in index) {
                        return index[id];
                    } else {
                        throw new Error(`cannot load module ${id}`);
                    }
                },
                transform(code, id) {
                    if (id.endsWith('.svelte')) {
                        const filename = id.split('/').pop();

                        if (versionConfig.checkForRunes) {
                            const found = detectSvelte5Syntax(code);
                            if (found) {
                                throw new Error(
                                    `${filename}: uses Svelte 5 syntax (${found}), which isn't ` +
                                        `supported when compiling against ${versionConfig.label}. ` +
                                        `Switch this module to Svelte 5 to use it.`
                                );
                            }
                        }

                        const compiled = versionConfig.compile(code, { dev: true, filename });
                        return compiled.js;
                    }
                    return null;
                },
            },
        ],
    });

    const generated = await bundle.generate({
        format: 'iife',
        name: mainId,
        exports: 'named',
    });
    return generated.output[0].code;
}

addEventListener('message', (e) => {
    if (e.data.type === 'bundle') {
        bundleModules(e.data.modules, e.data.main, e.data.mainId, e.data.version)
            .then((result) => {
                postMessage({ id: e.data.id, success: true, result });
            })
            .catch((error) => {
                console.error(error);
                postMessage({ id: e.data.id, success: false, error: error.toString() });
            });
    }
});
