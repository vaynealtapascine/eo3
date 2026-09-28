import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import { compile } from 'svelte-v4/compiler';
import { createRequire } from 'node:module';
import { examples } from '../assets/workskins/examples.mjs';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildWritingLab(output, catalog) {
    const components = [...new Set(Object.values(examples).map((x) => x.component))];
    const sources = new Map();
    for (const name of [...components, 'FicText'])
        sources.set(
            '/' + name + '.svelte',
            fs.readFileSync(path.join(root, 'assets/workskins', name + '.svelte'), 'utf8')
        );
    sources.set(
        '/writing',
        fs.readFileSync(path.join(root, 'assets/workskins/writing.js'), 'utf8')
    );
    sources.set(
        '/Lab.svelte',
        `<script>
${components.map((name) => `import ${name} from './${name}.svelte';`).join('\n')}
const components = { ${components.join(', ')} };
const catalog = ${JSON.stringify(
            catalog.map((x) => ({
                id: x.id,
                title: x.title,
                guide: x.writingGuide,
                writing: x.writing,
                component: examples[x.id].component,
            }))
        )};
let selected = new URLSearchParams(location.search).get('example') || 'text-messages';
if (!catalog.some(x => x.id === selected)) selected = 'text-messages';
let drafts = Object.fromEntries(catalog.map(x => [x.id, x.writing]));
let styled = true;
$: item = catalog.find(x => x.id === selected);
$: draft = drafts[selected];
function write(value) { drafts = { ...drafts, [selected]: value }; }
function toggleStyle() { styled = !styled; document.getElementById('creator-style').disabled = !styled; }
</script>
<div class="lab">
    <div class="toolbar"><label>Example <select bind:value={selected}>{#each catalog as option}<option value={option.id}>{option.title}</option>{/each}</select></label>
    <button type="button" on:click={() => write(item.writing)}>Reset this example</button></div>
    <p class="guide">{item.guide}</p>
    <div class="panes"><div class="input-pane"><label for="writing-input">Writing input</label><textarea id="writing-input" value={draft} on:input={e => write(e.currentTarget.value)} spellcheck="false"></textarea></div>
    <div class="output-pane"><div class="output-label"><span>Live preview</span><button type="button" aria-pressed={styled} on:click={toggleStyle}>{styled ? 'Workskin on' : 'Workskin off'}</button></div>
    <div id="workskin"><svelte:component this={components[item.component]} text={draft} variant={selected === 'group-chat' ? 'group' : 'messages'} /></div></div></div>
    <p class="foot">Edits stay here while this preview is open. <a href={'/eo3/?example=ao3-' + selected + '.toml'} target="_top">Open the full example in EO3 ↗</a></p>
</div>`
    );
    sources.set(
        '/entry.js',
        "import Lab from './Lab.svelte'; new Lab({target: document.getElementById('app')});"
    );
    const bundle = await rollup({
        input: '/entry.js',
        plugins: [
            {
                name: 'writing-lab',
                resolveId(id, importer) {
                    if (!id.startsWith('.') && id.startsWith('svelte'))
                        return require.resolve(id.replace(/^svelte(?=\/|$)/, 'svelte-v4'));
                    const resolved = id.startsWith('.')
                        ? sources.has(importer)
                            ? path.posix.resolve(path.posix.dirname(importer), id)
                            : path.resolve(path.dirname(importer), id)
                        : id;
                    if (sources.has(resolved) || fs.existsSync(resolved)) return resolved;
                    throw new Error(`Unresolved lab import ${id}`);
                },
                load(id) {
                    return sources.get(id) ?? fs.readFileSync(id, 'utf8');
                },
                transform(code, id) {
                    if (id.endsWith('.svelte'))
                        return compile(code, { filename: id, dev: false }).js.code;
                },
            },
        ],
    });
    try {
        const generated = await bundle.generate({ format: 'iife' });
        fs.writeFileSync(path.join(output, 'writing-lab.js'), generated.output[0].code);
    } finally {
        await bundle.close();
    }
    const css = Object.keys(examples)
        .map((id) =>
            fs.readFileSync(path.join(root, 'assets/workskins/styles', id + '.css'), 'utf8')
        )
        .join('\n');
    fs.writeFileSync(
        path.join(output, 'writing-lab.html'),
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>EO3 · Try the writing examples</title><style>
*{box-sizing:border-box}body{--lab-bg:#eee;--lab-ink:#292929;--lab-muted:#606060;--lab-line:#bbb;--lab-input:#fff;--lab-accent:#870000;margin:0;background:var(--lab-bg);color:var(--lab-ink);font:14px/1.5 Arial,sans-serif;overflow-wrap:break-word}.lab{padding:20px}.toolbar,.output-label{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.toolbar{background:#111;color:#eee;margin:-20px -20px 20px;padding:14px 20px;border-bottom:2px solid #870000}.toolbar label{display:flex;align-items:center;gap:10px;flex-wrap:wrap}label,.output-label{font-weight:bold;font-size:12px}button,select{font:inherit;color:var(--lab-ink);border:1px solid var(--lab-line);border-radius:3px;background:var(--lab-input);padding:7px 10px;max-width:100%;box-shadow:inset 0 1px #ffffff30,0 1px 1px #0002}button{cursor:pointer}.guide{font-size:12px;color:var(--lab-muted);min-height:3em}.panes{display:grid;grid-template-columns:1fr 1fr;gap:20px}.input-pane,.output-pane{min-width:0}.input-pane>label,.output-label{display:flex;align-items:center;min-height:38px;border-bottom:1px solid var(--lab-line);padding-bottom:8px}textarea{display:block;width:100%;height:390px;resize:vertical;margin-top:12px;border:1px solid var(--lab-line);border-radius:2px;padding:16px;background:var(--lab-input);color:var(--lab-ink);font:13px/1.7 'Courier New',monospace}.output-label button{font-size:11px;padding:3px 8px}#workskin{margin-top:12px;background:#fff9f2;color:#2a2a2a;padding:1px 14px;height:390px;overflow:auto;border:1px solid var(--lab-line);font:16px/1.65 Georgia,serif}#workskin p{margin:0 0 1em}#workskin blockquote{margin:1em 0;padding:0 1em;border-left:2px solid #ccc}.foot{font-size:11px;margin-bottom:0;color:var(--lab-muted)}a{color:var(--lab-accent);text-underline-offset:3px}:focus-visible{outline:2px solid var(--lab-accent);outline-offset:2px}@media(max-width:600px){.lab{padding:16px}.toolbar{margin:-16px -16px 16px;padding:12px 16px;gap:8px}.panes{grid-template-columns:1fr}textarea{height:260px}#workskin{height:320px}}@media(prefers-color-scheme:dark){body{--lab-bg:#222;--lab-ink:#eee;--lab-muted:#bbb;--lab-line:#666;--lab-input:#333;--lab-accent:#ed9696;color-scheme:dark}}
</style><style id="creator-style">${css}</style><script src="writing-lab.js" defer></script></head><body><div id="app"></div><noscript><p>This writing preview needs JavaScript. <a href="/eo3/about#examples">Browse the examples and downloads.</a></p></noscript></body></html>\n`
    );
}
