// Evaluate the actual named imports and Svelte components in a bundled document.
// Both gallery previews and tests use this, instead of a second HTML template.
import { compile } from 'svelte-v4/compiler';
import { rollup } from 'rollup';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const runtime = pathToFileURL(require.resolve('svelte-v4/internal')).href;

export async function renderWorkskinDocument(doc) {
    const mainIndex = doc.modules.findIndex(
        (m) => m.plugin === 'source.svelte' && m.sends?.includes('output')
    );
    if (mainIndex < 0) throw new Error('Missing Svelte output module');
    const sources = new Map([['/Main.svelte', doc.modules[mainIndex].data.contents]]);
    for (const module of doc.modules) {
        if (module.sends?.includes(mainIndex) && module.plugin === 'source.svelte-component')
            sources.set('/' + module.data.name + '.svelte', module.data.contents);
        for (const name of module.namedSends?.[mainIndex] || [])
            sources.set(
                '/' + name,
                module.data.language === 'javascript'
                    ? module.data.contents
                    : // Generated Settings modules hold a value for every field.
                      `export default ${JSON.stringify(
                          module.plugin === 'source.settings'
                              ? module.data.values
                              : module.data.contents
                      )};`
            );
    }
    const bundle = await rollup({
        input: '/Main.svelte',
        plugins: [
            {
                name: 'eo3-document-svelte',
                resolveId(id, importer) {
                    if (id === 'svelte/internal') return { id: runtime, external: true };
                    const resolved = id.startsWith('.')
                        ? new URL(id, 'file://' + importer).pathname
                        : id;
                    if (!sources.has(resolved)) throw new Error(`Unwired import: ${id}`);
                    return resolved;
                },
                load(id) {
                    return sources.get(id);
                },
                transform(code, id) {
                    if (id.endsWith('.svelte'))
                        return compile(code, { filename: id, generate: 'ssr' }).js.code;
                },
            },
        ],
    });
    try {
        const generated = await bundle.generate({ format: 'es' });
        const module = await import(
            'data:text/javascript;base64,' +
                Buffer.from(generated.output[0].code).toString('base64')
        );
        const rendered = module.default.render();
        if (rendered.css.code) throw new Error('Example styles must be in the workskin module');
        return {
            html: rendered.html,
            css: doc.modules
                .filter((m) => m.data.language === 'css' && m.sends?.includes('output'))
                .map((m) => m.data.contents)
                .join('\n'),
        };
    } finally {
        await bundle.close();
    }
}
