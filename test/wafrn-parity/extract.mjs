// Regenerates src/targets/wafrn/sanitizer-config.json from wafrn's own frontend source (codeberg.org/wafrn/wafrn):
// the `sanitizeHtml(content, {...})` call in PostRenderingService.getPostHtml, which is what a
// wafrn reader's browser runs on every post. The source is parsed as text (never executed).
//
//   node test/wafrn-parity/extract.mjs [ref] [--force]
//
// Like the AO3 generator, it only rewrites the file when the source changed (or with --force).

import { readFile, writeFile } from 'node:fs/promises';

const REPO = 'wafrn/wafrn';
const PATH = 'packages/frontend/src/app/services/post-rendering.service.ts';
const OUT = new URL('../../src/targets/wafrn/sanitizer-config.json', import.meta.url);

const args = process.argv.slice(2);
const force = args.includes('--force');
const ref = args.find((a) => !a.startsWith('--')) ?? 'main';

async function get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
    return res;
}

const { sha: commit } = await (
    await get(`https://codeberg.org/api/v1/repos/${REPO}/git/commits/${ref}`)
).json();
const source = await (
    await get(`https://codeberg.org/${REPO}/raw/commit/${commit}/${PATH}`)
).text();

const previous = await readFile(OUT, 'utf8').then(JSON.parse, () => ({}));
const sourceHash = [...source]
    .reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
    .toString(36);
if (!force && previous.sourceHash === sourceHash) {
    console.log(`wafrn sanitizer unchanged since ${previous.commit}; nothing to do.`);
    process.exit(0);
}

/** The text of the balanced (...) / [...] / {...} group that starts at `open`. */
function group(text, open) {
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const stack = [];
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === "'" || c === '"') {
            i = text.indexOf(c, i + 1);
            continue;
        }
        if (pairs[c]) stack.push(pairs[c]);
        else if (c === stack[stack.length - 1]) {
            stack.pop();
            if (!stack.length) return text.slice(open, i + 1);
        }
    }
    throw new Error('unbalanced group');
}
const strings = (text) => [...text.matchAll(/'([^']*)'/g)].map((m) => m[1]);

const method = source.indexOf('getPostHtml(');
if (method === -1) throw new Error('getPostHtml not found; the extractor needs updating');
const tagsDecl = 'tags: string[] =';
const tagsStart = source.indexOf('[', source.indexOf(tagsDecl, method) + tagsDecl.length);
const tags = strings(group(source, tagsStart));

const call = source.indexOf('sanitizeHtml(content, {', method);
const options = group(source, source.indexOf('{', call));
const attrsText = group(options, options.indexOf('{', options.indexOf('allowedAttributes')));
const allowedAttributes = Object.fromEntries(
    [...attrsText.matchAll(/(?:'([^']+)'|(\w+))\s*:\s*\[([^\]]*)\]/g)].map((m) => [
        m[1] ?? m[2],
        strings(m[3]),
    ])
);
const stylesText = group(
    options,
    options.indexOf('{', options.indexOf("'*'", options.indexOf('allowedStyles')))
);
const allowedStyles = [...stylesText.matchAll(/(?:'([^']+)'|([\w-]+))\s*:\s*\[/g)].map(
    (m) => m[1] ?? m[2]
);
if (!tags.length || !Object.keys(allowedAttributes).length || !allowedStyles.length) {
    throw new Error('extraction came back empty; the extractor needs updating');
}

const lock = await (
    await get(`https://codeberg.org/${REPO}/raw/commit/${commit}/package-lock.json`)
).json();
const sanitizeHtmlVersion = lock.packages?.['node_modules/sanitize-html']?.version;
if (!sanitizeHtmlVersion) throw new Error('sanitize-html not found in package-lock.json');

const config = {
    commit,
    sanitizeHtmlVersion,
    source: `https://codeberg.org/${REPO}/src/commit/${commit}/${PATH}`,
    sourceHash,
    allowVulnerableTags: /allowVulnerableTags:\s*true/.test(options),
    allowedTags: [...new Set(tags)],
    allowedAttributes,
    allowedStyles,
};
await writeFile(OUT, JSON.stringify(config, null, 2) + '\n');
console.log(`Wrote sanitizer-config.json from ${REPO}@${commit.slice(0, 7)}.`);
