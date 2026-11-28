// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
    fillLineFormat,
    insertSourceLine,
    moveSourceLine,
    readSourceLines,
    removeSourceLine,
    replaceSourceLine,
    sourceLineKind,
} from '../../src/editor/source-lines';

const HTML = '<p>mylo:: What the helly</p><p class="x">mula:: <em>whatever</em></p>';

describe('source lines', () => {
    it('picks the line model from the text module language', () => {
        expect(sourceLineKind('html')).toBe('html');
        expect(sourceLineKind('html-contenteditable')).toBe('html');
        expect(sourceLineKind('text')).toBe('text');
        expect(sourceLineKind(undefined)).toBe('text');
    });

    it('reads HTML lines as top-level elements and text lines by newline', () => {
        expect(readSourceLines(HTML, 'html')).toEqual(['mylo:: What the helly', 'mula:: whatever']);
        expect(readSourceLines('<!-- note --><p>a</p>\n<p>b</p>', 'html')).toEqual(['a', 'b']);
        expect(readSourceLines('a\r\nb\n', 'text')).toEqual(['a', 'b', '']);
        expect(readSourceLines('', 'text')).toEqual([]);
    });

    it('replaces a line, keeping its element and escaping text', () => {
        expect(replaceSourceLine(HTML, 'html', 1, 'mylo:: <3')).toBe(
            '<p>mylo:: What the helly</p><p class="x">mylo:: &lt;3</p>'
        );
        // Unchanged text and out-of-range lines leave the source exactly as it was.
        expect(replaceSourceLine(HTML, 'html', 0, 'mylo:: What the helly')).toBe(HTML);
        expect(replaceSourceLine(HTML, 'html', 5, 'x')).toBe(HTML);
        expect(replaceSourceLine('a\r\nb', 'text', 1, 'c')).toBe('a\r\nc');
    });

    it('inserts lines copying the neighbouring element', () => {
        expect(insertSourceLine(HTML, 'html', 1, 'mula:: hi')).toBe(
            HTML + '<p class="x">mula:: hi</p>'
        );
        expect(insertSourceLine(HTML, 'html', -1, 'first')).toBe('<p>first</p>' + HTML);
        expect(insertSourceLine('', 'html', -1, 'only')).toBe('<p>only</p>');
        expect(insertSourceLine('a\nb', 'text', 0, 'x')).toBe('a\nx\nb');
        expect(insertSourceLine('', 'text', -1, 'x')).toBe('x');
    });

    it('removes and moves lines', () => {
        expect(removeSourceLine(HTML, 'html', 0)).toBe('<p class="x">mula:: <em>whatever</em></p>');
        expect(removeSourceLine('a\nb\nc', 'text', 1)).toBe('a\nc');
        expect(moveSourceLine(HTML, 'html', 1, -1)).toBe(
            '<p class="x">mula:: <em>whatever</em></p><p>mylo:: What the helly</p>'
        );
        expect(moveSourceLine(HTML, 'html', 1, 1)).toBe(HTML);
        expect(moveSourceLine('a\nb\nc', 'text', 0, 1)).toBe('b\na\nc');
    });

    it('fills line formats', () => {
        expect(fillLineFormat('{speaker}:: {text}', { speaker: 'mylo', text: 'hi' })).toBe(
            'mylo:: hi'
        );
        expect(fillLineFormat('{{literal}} {missing}!', {})).toBe('{literal} !');
    });
});
