import { describe, expect, it } from 'vitest';
import { splitHtml, splitHtmlAtMarker, SPLIT_MARKER } from '../../src/util/split-html';

const underLength = (max: number) => (html: string) => html.length <= max;

describe('splitHtml', () => {
    it('splits at the last top-level block boundary that fits', () => {
        const html = '<p>one</p><p>two</p><p>three</p><p>four</p>';
        expect(splitHtml(html, underLength('<p>one</p><p>two</p>'.length))).toEqual({
            first: '<p>one</p><p>two</p>',
            second: '<p>three</p><p>four</p>',
        });
    });

    it('never splits inside a block', () => {
        const html = '<p>a very long first paragraph</p><p>b</p>';
        expect(splitHtml(html, underLength(10))).toBeNull();
    });

    it('closes and reopens a wrapper around the whole content', () => {
        const html = '\n<div class="story" dir="rtl">\n<p>one</p>\n<p>two</p>\n</div>\n';
        const result = splitHtml(html, (h) => !h.includes('two'))!;
        expect(result.first).toBe('<div class="story" dir="rtl">\n<p>one</p></div>');
        expect(result.second).toBe('<div class="story" dir="rtl">\n<p>two</p>\n</div>');
    });

    it('keeps text and inline runs between blocks with the block before the cut', () => {
        const html = 'intro <b>bold</b><p>para</p>';
        expect(splitHtml(html, (h) => !h.includes('para'))).toEqual({
            first: 'intro <b>bold</b>',
            second: '<p>para</p>',
        });
    });

    it('returns null when there is only one block', () => {
        expect(splitHtml('<p>only</p>', () => true)).toBeNull();
    });
});

describe('splitHtmlAtMarker', () => {
    it('splits at an explicit marker between paragraphs', () => {
        expect(splitHtmlAtMarker(`<p>one</p>${SPLIT_MARKER}<p>two</p>`)).toEqual({
            first: '<p>one</p>',
            second: '<p>two</p>',
        });
    });

    it('reopens a surrounding wrapper and leaves later markers for later splits', () => {
        const html = `<div class="story"><p>one</p>${SPLIT_MARKER}<p>two</p>${SPLIT_MARKER}<p>three</p></div>`;
        expect(splitHtmlAtMarker(html)).toEqual({
            first: '<div class="story"><p>one</p></div>',
            second: `<div class="story"><p>two</p>${SPLIT_MARKER}<p>three</p></div>`,
        });
    });

    it('requires content on both sides of the marker', () => {
        expect(splitHtmlAtMarker(`${SPLIT_MARKER}<p>only</p>`)).toBeNull();
        expect(splitHtmlAtMarker(`<div>${SPLIT_MARKER}<p>only</p></div>`)).toBeNull();
        expect(splitHtmlAtMarker('<p>no marker</p>')).toBeNull();
    });
});
