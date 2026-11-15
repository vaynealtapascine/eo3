import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/plugins', () => ({ MODULES: {} }));
import { Document, Module, ModulePlugin } from '../../src/document';
import { countWords, workWordCount } from '../../src/util/word-count';

describe('countWords', () => {
    it('counts what a reader sees, not the markup', () => {
        expect(countWords('')).toBe(0);
        expect(countWords('<p>One, two&nbsp;three.</p><p>Four!</p>')).toBe(4);
        expect(countWords('<p class="fx-letter note">Dear <em>friend</em>,</p>')).toBe(2);
        expect(countWords('<!-- eo3:split --><p>After the break</p>')).toBe(3);
        expect(countWords('<style>.a { color: red; }</style><p>Styled</p>')).toBe(1);
    });

    it('keeps contractions and hyphenated words whole and counts numbers', () => {
        expect(countWords("It’s a well-known fact: 42 isn't odd.")).toBe(7);
    });

    it('counts each character in scripts written without spaces', () => {
        expect(countWords('你好吗')).toBe(3);
        expect(countWords('Hello 世界 again')).toBe(4);
    });
});

describe('workWordCount', () => {
    const plugin = (id: string): ModulePlugin<any> => ({
        id,
        acceptsInputs: false,
        acceptsNamedInputs: false,
        component: () => null,
        initialData: () => ({}),
        description: () => id,
        eval: async () => null as any,
    });

    it('adds up the writing and leaves styles, scripts and other modules out', () => {
        const doc = new Document();
        const text = plugin('source.text');
        doc.insertModule(new Module(text, { contents: '<p>Two words</p>', language: 'html' }));
        doc.insertModule(
            new Module(text, {
                contents: '<p>And three more</p>',
                language: 'html-contenteditable',
            })
        );
        doc.insertModule(new Module(text, { contents: 'NAME: plain text', language: 'text' }));
        doc.insertModule(new Module(text, { contents: '.a { color: red }', language: 'css' }));
        doc.insertModule(new Module(text, { contents: 'let a = 1;', language: 'javascript' }));
        doc.insertModule(new Module(plugin('source.sass'), { contents: 'many words in here' }));
        expect(workWordCount(doc)).toBe(8);
    });
});
