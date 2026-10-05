import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { examples } from '../assets/workskins/examples.mjs';
import { appearanceFields, writingHelp, headerHelp } from '../assets/workskins/writing-help.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, 'assets/workskins', name), 'utf8');

/** A sample's header fields (`Key: value` between `---` lines) and the text after them. */
export function splitHeader(writing) {
    const header = writing.match(/^---\n([\s\S]*?)\n---\n/);
    if (!header) return { fields: [], body: writing };
    const fields = header[1].split('\n').map((line) => {
        const [, key, value] = line.match(/^([\w -]+):\s*(.*)$/);
        return { key, value };
    });
    return { fields, body: writing.slice(header[0].length) };
}

/** A sample's writing as one text, details header included. */
export function sampleWriting(item) {
    return examples[item.id].writing;
}

export function workskinDocument(item) {
    const sample = examples[item.id];
    const { fields, body } = splitHeader(sample.writing);
    for (const key of Object.keys(sample.settings)) {
        if (!fields.some((field) => field.key === key)) fields.push({ key, value: '' });
    }
    const main = `<script>\n    import draft from './draft';\n    import settings from './settings';\n    import { withSettings } from './writing';\n    import ${
        sample.component
    } from './${
        sample.component
    }.svelte';\n    const { _size, _width, _font, ...details } = settings;\n    const sizes = { Larger: 'fx-size-larger', Largest: 'fx-size-largest' };\n    const widths = { Narrow: 'fx-width-narrow', Wide: 'fx-width-wide' };\n    const fonts = { Serif: 'fx-font-serif', 'Sans serif': 'fx-font-sans', Monospace: 'fx-font-mono' };\n</script>\n\n<!-- The details fill in the text's header; a header written in the text itself wins. -->\n<div class={['fx-appearance', sizes[_size], widths[_width], fonts[_font]].filter(Boolean).join(' ')}>\n<${
        sample.component
    } text={withSettings(draft, details)} ${sample.props || ''}/>\n</div>\n`;
    return {
        version: 1,
        title: 'AO3 · ' + item.title,
        sharedStyles: 1,
        groups: [
            {
                id: 'fic-' + item.id + '-renderer',
                title: item.title + ' · reusable renderer',
                modules: [0, 2, 3, 4, 5, 6],
                inputs: [
                    { module: 6, label: 'Details' },
                    { module: 0, label: 'Your text' },
                ],
            },
        ],
        modules: [
            {
                plugin: 'source.text',
                title: 'Write here · ' + sample.syntax,
                data: {
                    language: 'text',
                    contents: body,
                    help: {
                        summary:
                            'Edit Details above, then write here. Clear optional fields to omit them.',
                        examples: [...writingHelp[item.id], headerHelp].map(
                            ([syntax, description]) => ({ syntax, description })
                        ),
                    },
                },
                namedSends: { 2: ['draft'] },
            },
            {
                plugin: 'source.text',
                title: 'Workskin · colors and spacing',
                data: {
                    language: 'css',
                    contents:
                        (sample.component === 'ChatLog'
                            ? read('styles/text-messages.css') +
                              '\n' +
                              read('styles/group-chat.css')
                            : read('styles/' + item.id + '.css')) +
                        '\n' +
                        read('styles/appearance.css'),
                },
                sends: ['output'],
            },
            {
                plugin: 'source.svelte',
                title: 'Compose · reuse the component here',
                data: { svelteVersion: 'v4', contents: main },
                sends: ['output'],
            },
            {
                plugin: 'source.svelte-component',
                title: sample.component + ' · layout',
                data: { name: sample.component, contents: read(sample.component + '.svelte') },
                sends: [2],
            },
            {
                plugin: 'source.svelte-component',
                title: 'FicText · shared emphasis and paragraphs',
                data: { name: 'FicText', contents: read('FicText.svelte') },
                sends: [2],
            },
            {
                plugin: 'source.text',
                title: 'Writing helpers · shared parser',
                data: { language: 'javascript', contents: read('writing.js') },
                namedSends: { 2: ['writing'] },
            },
            {
                plugin: 'source.settings',
                title: 'Details · ' + item.title.toLowerCase(),
                data: {
                    fields: [
                        ...fields.map(({ key, value }) => ({
                            key,
                            default: value,
                            section: sample.settings[key]?.advanced ? 'Extras' : '',
                            ...sample.settings[key],
                        })),
                        ...appearanceFields,
                    ],
                    values: Object.fromEntries([
                        ...fields.map(({ key, value }) => [key, value]),
                        ...appearanceFields.map((field) => [field.key, field.default]),
                    ]),
                },
                namedSends: { 2: ['settings'] },
            },
        ],
    };
}

export function workskinGroup(item, doc = workskinDocument(item)) {
    return {
        eo3: 'group',
        version: 1,
        title: 'AO3 · ' + item.title,
        inputs: doc.groups[0].inputs,
        modules: doc.modules.map(({ graphPos, sends, ...module }) => ({
            ...module,
            ...(sends ? { sends: sends.filter((s) => typeof s === 'number') } : {}),
            ...(graphPos ? { position: graphPos } : {}),
        })),
    };
}

export function documentToml(doc) {
    const quote = (v) => JSON.stringify(v);
    const inline = (value) =>
        Array.isArray(value)
            ? `[${value.map(inline).join(', ')}]`
            : value !== null && typeof value === 'object'
            ? `{ ${Object.entries(value)
                  .map(([key, entry]) => `${quote(key)} = ${inline(entry)}`)
                  .join(', ')} }`
            : quote(value);
    const literal = (v) => {
        if (v.includes("'''")) throw new Error('TOML literal delimiter in source');
        return "'''\n" + v + (v.endsWith('\n') ? '' : '\n') + "'''";
    };
    return (
        '# Generated by scripts/build-workskin-documents.mjs from assets/workskins.\n' +
        `version = 1\ntitle = ${quote(doc.title)}\nsharedStyles = ${doc.sharedStyles}\n` +
        doc.groups
            .map(
                (g) =>
                    `groups = [{ id = ${quote(g.id)}, title = ${quote(g.title)}, ` +
                    `modules = [${g.modules.join(', ')}], inputs = [${g.inputs
                        .map((i) => `{ module = ${i.module}, label = ${quote(i.label)} }`)
                        .join(', ')}] }]\n`
            )
            .join('') +
        doc.modules
            .map(
                (m) =>
                    '\n[[modules]]\n' +
                    `plugin = ${quote(m.plugin)}\ntitle = ${quote(m.title)}\n` +
                    (m.graphPos ? `graphPos = [${m.graphPos.join(', ')}]\n` : '') +
                    (m.data.language ? `data.language = ${quote(m.data.language)}\n` : '') +
                    (m.data.svelteVersion
                        ? `data.svelteVersion = ${quote(m.data.svelteVersion)}\n`
                        : '') +
                    (m.data.help ? `data.help = ${inline(m.data.help)}\n` : '') +
                    (m.data.name ? `data.name = ${quote(m.data.name)}\n` : '') +
                    (m.data.contents !== undefined
                        ? `data.contents = ${literal(m.data.contents)}\n`
                        : '') +
                    (m.data.fields
                        ? `data.fields = [${m.data.fields
                              .map(
                                  (f) =>
                                      `{ ${Object.entries(f)
                                          .map(([key, value]) => `${key} = ${inline(value)}`)
                                          .join(', ')} }`
                              )
                              .join(', ')}]\n` +
                          `data.values = { ${Object.entries(m.data.values)
                              .map(([k, v]) => `${quote(k)} = ${quote(v)}`)
                              .join(', ')} }\n`
                        : '') +
                    (m.sends ? `sends = [${m.sends.map(quote).join(', ')}]\n` : '') +
                    (m.namedSends
                        ? `namedSends = { ${Object.entries(m.namedSends)
                              .map(
                                  ([key, values]) =>
                                      `${quote(key)} = [${values.map(quote).join(', ')}]`
                              )
                              .join(', ')} }\n`
                        : '')
            )
            .join('')
    );
}
