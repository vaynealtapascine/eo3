import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '@ltd/j-toml';
import { renderAo3Content, cleanWorkskinCss } from '../../src/targets/ao3/render';
import { exampleFromSearch } from '../../src/storage/example-link';
import catalog from '../../assets/examples/workskins.json';
import index from '../../assets/examples/index.json';

describe('bundled AO3 workskin examples', () => {
    for (const item of catalog) {
        it(`${item.title}: survives AO3 processing with its text and styles intact`, () => {
            const source = fs.readFileSync(`assets/examples/${item.file}`, 'utf8');
            const doc = parse(source, { joiner: '\n', bigint: false }) as any;
            expect(doc.version).toBe(1);
            expect(doc.sharedStyles).toBe(1);
            expect(doc.modules).toHaveLength(2);
            const [htmlModule, cssModule] = doc.modules;
            expect(htmlModule.sends).toEqual(['output']);
            expect(cssModule.sends).toEqual(['output']);
            const diagnostics: unknown[] = [];
            const rendered = renderAo3Content(htmlModule.data.contents, (d) => diagnostics.push(d));
            const cleaned = cleanWorkskinCss(cssModule.data.contents, {
                prefix: '#workskin',
                onDiagnostic: (d) => diagnostics.push(d),
            });
            expect(diagnostics).toEqual([]);
            expect(cleaned).not.toBe('');
            expect(cleanWorkskinCss(cleaned, { prefix: '#workskin' })).toBe(cleaned);
            const before = document.createElement('div');
            const after = document.createElement('div');
            before.innerHTML = htmlModule.data.contents;
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
            expect(htmlModule.data.contents).not.toMatch(/<(?:script|iframe|img|svg)\b|\bstyle=/i);
            expect(cssModule.data.contents).not.toMatch(/url\(|@import|var\(|\.eo3-/);
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
