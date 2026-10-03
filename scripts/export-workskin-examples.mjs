// Package the authored examples for the editor, the landing gallery, and offline use.
// The TOML documents are the source of truth; previews and downloads use the same modules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@ltd/j-toml';
import { renderWorkskinDocument } from './render-workskin-document.mjs';
import { workskinGroup } from './workskin-documents.mjs';
import { examples } from '../assets/workskins/examples.mjs';
import { buildWritingLab } from './build-writing-lab.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'dist/workskin-examples'));
const source = path.join(root, 'assets/examples');
const catalog = JSON.parse(fs.readFileSync(path.join(source, 'workskins.json'), 'utf8')).map(
    (item) => ({
        ...item,
        syntax: examples[item.id].syntax,
        writingGuide: examples[item.id].guide,
        writing: examples[item.id].writing,
    })
);
fs.mkdirSync(output, { recursive: true });
const files = [];
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const baseCss = `html { color-scheme: light; } * { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: #fff; color: #2a2a2a; font: 16px/1.65 Georgia, serif; overflow-wrap: break-word; }
p { margin: 0 0 1em; } h3 { font-size: 1.25em; line-height: 1.3; } h4 { font-size: 1.05em; }
a { color: #32665a; text-underline-offset: 3px; } blockquote { margin: 1em 0; padding: 0 1em; border-left: 2px solid #ccc; }
@media (max-width: 400px) { body { padding: 16px; } }
`;

for (const item of catalog) {
    const toml = fs.readFileSync(path.join(source, item.file), 'utf8');
    const doc = parse(toml, { joiner: '\n', bigint: false });
    const { html, css } = await renderWorkskinDocument(doc);
    const preview = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(
        item.title
    )} — EO3 example</title><style>${baseCss}</style><style id="creator-style">${css}</style></head>
<body><div id="workskin">${html}</div></body></html>\n`;
    const entries = [
        [item.file, toml],
        [`${item.id}.html`, html + '\n'],
        [`${item.id}.css`, css + '\n'],
        // The plain-text download keeps the details as a header, so it works on its own.
        [`${item.id}.txt`, examples[item.id].writing],
        [`${item.id}.eo3group.json`, JSON.stringify(workskinGroup(item, doc), null, 2) + '\n'],
    ];
    for (const [name, text] of entries) {
        fs.writeFileSync(path.join(output, name), text);
        files.push([name, Buffer.from(text)]);
    }
    fs.writeFileSync(path.join(output, `${item.id}-preview.html`), preview);
}
const readme = `# EO3 workskin examples

${catalog.length} editable AO3 workskin examples. The sample prose is standard Lorem ipsum,
with neutral names, labels, and dates. No generated story content or external assets.

Open a .toml document with EO3's File > load control. Edit the first "Write here"
plain-text module; the Svelte component generates the HTML. Change colors and
spacing in the separate Workskin module. You do not need to edit the renderer.
Optional headers go between --- lines at the start. *Text*, **text**, ~~text~~,
and backtick code work in prose; blank lines separate paragraphs. This is a small
writing syntax, not full Markdown. Terminal logs are displayed literally.

To reuse an example in an existing fic, import its .eo3group.json from add node >
Groups > import. Its internal links are preserved. Connect the Compose and
Workskin modules to the chapter output; group imports arrive unwired from chapters.
You can connect another named text input to Compose, import it, and call the same
component a second time. Each component takes a text prop. ChatLog also takes
variant ("messages" or "group") and self; Footnotes takes a unique id.

For AO3: copy the .css text into a new Work Skin, choose that skin on your work,
and paste the matching .html text into the chapter's HTML editor. The .html files
are chapter fragments, not full web pages. Preview your AO3 draft before posting.

Each example uses its own fic-* class prefix and may be combined with the others.
Names, timestamps, section labels, and footnotes are rendered as real HTML. Test with the
creator's style hidden and on a narrow screen. Workskins affect a work's contents,
not AO3's surrounding interface. EO3 does not post your work for you.

${catalog
    .map(
        (x) =>
            `## ${x.title}\n\n${x.description}\n\nWriting syntax: ${x.syntax}\n\n${x.writingGuide}\n\n${x.tip}\n\nFiles: ${x.file}, ${x.id}.txt, ${x.id}.eo3group.json, ${x.id}.html, ${x.id}.css\n`
    )
    .join('\n')}
Examples are MIT licensed, like EO3. Built on cpsdqs's prechoster.
Source: https://github.com/vaynealtapascine/eo3
AO3 guide: https://archiveofourown.org/faq/tutorial-creating-a-work-skin?language_id=en
`;
files.push(
    ['README.md', Buffer.from(readme)],
    ['LICENSE', fs.readFileSync(path.join(root, 'LICENSE'))]
);
fs.writeFileSync(path.join(output, 'README.md'), readme);
fs.writeFileSync(path.join(output, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'eo3-workskin-examples.zip'), zip(files));
await buildWritingLab(output, catalog);
console.log(`Packaged ${catalog.length} workskin examples into ${output}`);

// Dependency-free ZIP with stored (uncompressed) entries, UTF-8 names, and CRC-32.
function zip(entries) {
    const local = [],
        central = [];
    let offset = 0;
    for (const [filename, data] of entries) {
        const name = Buffer.from(filename);
        let crc = 0xffffffff;
        for (const byte of data) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0x800, 6);
        header.writeUInt16LE(0x21, 12); // 1980-01-01, deterministic archive date
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(data.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(name.length, 26);
        local.push(header, name, data);
        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50, 0);
        record.writeUInt16LE(20, 4);
        header.copy(record, 6, 4, 30);
        record.writeUInt32LE(offset, 42);
        central.push(record, name);
        offset += header.length + name.length + data.length;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
}
