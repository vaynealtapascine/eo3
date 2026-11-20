/**
 * Assembles the /about workskin gallery and static error page into dist/ so dist/
 * is a complete deployable site for eo3.dev.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const examplesDir = path.join(dist, 'workskin-examples');
const siteDir = path.join(root, 'site');

const escape = (text) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

if (!fs.existsSync(path.join(examplesDir, 'catalog.json'))) {
    throw new Error(
        'EO3 example exports are missing. Run scripts/export-workskin-examples.mjs first.'
    );
}

const aboutOut = path.join(dist, 'about');
fs.rmSync(aboutOut, { recursive: true, force: true });
fs.cpSync(path.join(siteDir, 'about'), aboutOut, { recursive: true });
fs.cpSync(examplesDir, path.join(aboutOut, 'examples'), { recursive: true });

const notFoundSrc = path.join(siteDir, '404.html');
if (fs.existsSync(notFoundSrc)) {
    fs.copyFileSync(notFoundSrc, path.join(dist, '404.html'));
}

const catalog = JSON.parse(fs.readFileSync(path.join(examplesDir, 'catalog.json'), 'utf8'));
const cards = catalog
    .map((item, index) => {
        const id = escape(item.id);
        const title = escape(item.title);
        const file = escape(item.file);
        return `<article class="eo3-example" data-category="${escape(item.category)}">
  <div class="eo3-example-top"><span>${String(index + 1).padStart(2, '0')} / ${escape(
            item.category
        )}</span><span>Plain text → workskin</span></div>
  <iframe src="/about/examples/${id}-preview.html" title="${title} example preview" sandbox="allow-same-origin" loading="lazy" data-example-preview></iframe>
  <div class="eo3-example-info"><h3><a href="/?example=${file}">${title}</a></h3><p>${escape(
            item.description
        )}</p><p class="eo3-writing-syntax"><code>${escape(item.syntax)}</code></p>
    <div class="eo3-example-links"><a class="eo3-open-example" href="/?example=${file}">Open in EO3 ↗</a><a href="/about/examples/${file}" download>Document ↓</a><a href="/about/examples/${id}-preview.html" target="_blank" rel="noopener">Full preview ↗</a></div>
    <details class="eo3-writing-guide"><summary>What you type</summary><p>${escape(
        item.writingGuide
    )}</p><pre><code>${escape(
            item.writing
        )}</code></pre><p><a href="/about/examples/writing-lab.html?example=${id}&amp;v=archive-editor-1" target="_blank" rel="noopener">Try writing this example ↗</a></p></details>
    <details class="eo3-example-tip"><summary>Reuse &amp; download</summary><p>${escape(
        item.tip
    )}</p><p><a href="/about/examples/${id}.eo3group.json" download>Reusable group ↓</a> · <a href="/about/examples/${id}.txt" download>Writing input ↓</a><br><a href="/about/examples/${id}.html" download>Chapter HTML ↓</a> · <a href="/about/examples/${id}.css" download>Workskin CSS ↓</a></p></details>
  </div>
</article>`;
    })
    .join('\n');

const aboutFile = path.join(aboutOut, 'index.html');
const page = fs.readFileSync(aboutFile, 'utf8');
if (!page.includes('<!-- EO3_GALLERY -->')) {
    throw new Error('EO3 gallery placeholder is missing in site/about/index.html.');
}
fs.writeFileSync(aboutFile, page.replace('<!-- EO3_GALLERY -->', cards));
console.log(`Built /about gallery with ${catalog.length} live workskin examples in ${aboutOut}`);
