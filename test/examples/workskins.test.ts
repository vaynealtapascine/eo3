import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '@ltd/j-toml';
import { renderAo3Content, cleanWorkskinCss } from '../../src/targets/ao3/render';
import { exampleFromSearch } from '../../src/storage/example-link';
import catalog from '../../assets/examples/workskins.json';
import index from '../../assets/examples/index.json';
import { renderWorkskinDocument } from '../../scripts/render-workskin-document.mjs';
import { sampleWriting, workskinGroup } from '../../scripts/workskin-documents.mjs';
import { normalize, withSettings } from '../../assets/workskins/writing.js';
import { parseGroupFile } from '../../src/storage/group-file';
import { SettingsData, settingsValues } from '../../src/plugins/source/settings-values';

describe('bundled AO3 workskin examples', () => {
    for (const item of catalog) {
        it(`${item.title}: renders its modular inputs and survives AO3 processing`, async () => {
            const source = fs.readFileSync(`assets/examples/${item.file}`, 'utf8');
            const doc = parse(source, { joiner: '\n', bigint: false }) as any;
            expect(doc.version).toBe(1);
            expect(doc.sharedStyles).toBe(1);
            expect(doc.modules).toHaveLength(7);
            const [writingModule, cssModule] = doc.modules;
            const settingsModule = doc.modules[6];
            expect(writingModule.data.language).toBe('text');
            expect(writingModule.namedSends).toEqual({ 2: ['draft'] });
            expect(settingsModule.plugin).toBe('source.settings');
            expect(settingsModule.namedSends).toEqual({ 2: ['settings'] });
            // Optional form metadata survives document generation and group exports.
            {
                expect(settingsModule.data.fields).toEqual(
                    (workskinGroup(item).modules[6].data as unknown as SettingsData).fields
                );
                expect(settingsValues({ ...settingsModule.data, values: {} })).toEqual(
                    settingsModule.data.values
                );
                expect(
                    settingsModule.data.fields.filter((field: any) => !field.advanced).length
                ).toBeLessThanOrEqual(4);
            }
            expect(writingModule.data.help.examples.length).toBeGreaterThanOrEqual(3);
            expect(writingModule.data.help.summary).toContain('Details');
            expect(
                settingsModule.data.fields.filter((f: any) => f.section === 'Appearance')
            ).toHaveLength(3);
            // The details form plus the text rebuild the sample exactly.
            const { _size, _width, _font, ...details } = settingsModule.data.values;
            expect(withSettings(writingModule.data.contents, details)).toBe(
                normalize(sampleWriting(item))
            );
            expect(doc.groups[0].modules).toEqual([0, 2, 3, 4, 5, 6]);
            expect(doc.groups[0].inputs).toEqual([
                { module: 6, label: 'Details' },
                { module: 0, label: 'Your text' },
            ]);
            expect(cssModule.sends).toEqual(['output']);
            expect(doc.modules[2].data.svelteVersion).toBe('v4');
            const { html } = await renderWorkskinDocument(doc);
            const diagnostics: unknown[] = [];
            const rendered = renderAo3Content(html, (d) => diagnostics.push(d));
            const cleaned = cleanWorkskinCss(cssModule.data.contents, {
                prefix: '#workskin',
                onDiagnostic: (d) => diagnostics.push(d),
            });
            expect(diagnostics).toEqual([]);
            expect(cleaned).not.toBe('');
            expect(cleanWorkskinCss(cleaned, { prefix: '#workskin' })).toBe(cleaned);
            const before = document.createElement('div');
            const after = document.createElement('div');
            before.innerHTML = html;
            after.innerHTML = rendered.html;
            const textNodes = (root: Element) => {
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                const text: string[] = [];
                while (walker.nextNode()) {
                    const value = walker.currentNode.textContent?.replace(/\s+/g, ' ').trim();
                    if (value) text.push(value);
                }
                return text;
            };
            // AO3 removes inter-element newlines; compare the actual text nodes.
            expect(textNodes(after)).toEqual(textNodes(before));
            expect([...after.querySelectorAll('[class]')].map((n) => n.className)).toEqual(
                [...before.querySelectorAll('[class]')].map((n) => n.className)
            );
            for (const anchor of after.querySelectorAll('a[href^="#"]')) {
                const target = anchor.getAttribute('href')!.slice(1);
                expect(after.querySelector(`a[name="${target}"]`)).not.toBeNull();
            }
            expect(Object.prototype.hasOwnProperty.call(index, item.file)).toBe(true);
            expect(html).not.toMatch(/<(?:script|iframe|img|svg)\b|\bstyle=/i);
            settingsModule.data.values._size = 'Larger';
            settingsModule.data.values._width = 'Wide';
            settingsModule.data.values._font = 'Serif';
            const customized = await renderWorkskinDocument(doc);
            expect(customized.html).toContain('fx-size-larger fx-width-wide fx-font-serif');
            expect(renderAo3Content(customized.html).html).toContain('fx-size-larger');
            expect(customized.html).not.toContain('_size:');
            // Restore before comparing the exported group data.
            Object.assign(settingsModule.data.values, { _size, _width, _font });
            expect(cssModule.data.contents).not.toMatch(/url\(|@import|var\(|\.eo3-/);
            const group = parseGroupFile(JSON.stringify(workskinGroup(item, doc)));
            expect(group.modules).toHaveLength(7);
            expect(group.inputs).toEqual(doc.groups[0].inputs);
            expect(group.modules[0].data).toEqual(writingModule.data);
            expect(group.modules[6].data).toEqual(settingsModule.data);
            expect(group.modules[0].namedSends).toEqual({ 2: ['draft'] });
            expect(group.modules[2].sends).toEqual([]);
            expect(group.modules[1].sends).toEqual([]);
            expect(group.modules[3].sends).toEqual([2]);
            expect(group.modules[5].namedSends).toEqual({ 2: ['writing'] });
        });
    }
});

describe('gallery links', () => {
    it('opens a bundled example', () => {
        expect(exampleFromSearch('?example=ao3-letter.toml')).toBe('ao3-letter.toml');
    });
    it('ignores unknown documents and prototype keys', () => {
        for (const id of ['missing.toml', '../../private.toml', 'toString', '__proto__']) {
            expect(exampleFromSearch(`?example=${encodeURIComponent(id)}`)).toBeNull();
        }
        expect(exampleFromSearch('')).toBeNull();
    });
});
