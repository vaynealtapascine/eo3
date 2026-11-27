import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { CSS_PIECES, findPieceById, type CssPiece } from '../../src/editor/css-pieces';
import { createEo3Extensions } from '../../src/editor/extensions';
import {
    readInlineTemplate,
    renderInlineTemplate,
    setInlineTemplateLibrary,
} from '../../src/editor/inline-template';
import {
    lintStyleTemplate,
    matchStyleTemplate,
    renderStyleTemplate,
    type StyleField,
} from '../../src/editor/style-template';
import { normalizeStyleEntry, parseStylePackFile } from '../../src/storage/style-file';
import { libraryStyleToPiece } from '../../src/storage/style-library';

describe('style templates', () => {
    it('fills in fields, conditions and defaults, escaping values', () => {
        const fields: StyleField[] = [
            { key: 'who', label: 'Who', default: 'Someone' },
            { key: 'loud', label: 'Loud', type: 'toggle' },
        ];
        const template =
            '<p class="note">{{#if loud}}<strong>{{who}}</strong>{{else}}{{who}}{{/if}}: {{selection}}</p>';
        expect(renderStyleTemplate(template, { selection: 'hi <there>', fields })).toBe(
            '<p class="note">Someone: hi &lt;there&gt;</p>'
        );
        expect(
            renderStyleTemplate(template, {
                selection: 'hi',
                fields,
                values: { who: 'Ann & Bo', loud: true },
            })
        ).toBe('<p class="note"><strong>Ann &amp; Bo</strong>: hi</p>');
        expect(renderStyleTemplate('<p>{{#if !loud}}quiet{{/if}}</p>', { fields })).toBe(
            '<p>quiet</p>'
        );
    });

    it('repeats per line with speakers, alternation and starter lines', () => {
        const template =
            '<div class="thread">{{#lines|First\nSecond}}<p class="{{alt:msg-in|msg-out}}">{{index}}. {{#if speaker}}[{{speaker}}] {{/if}}{{text}}</p>{{/lines}}</div>';
        expect(renderStyleTemplate(template)).toBe(
            '<div class="thread"><p class="msg-in">1. First</p><p class="msg-out">2. Second</p></div>'
        );
        expect(renderStyleTemplate(template, { selection: 'Al: hi\nBo: yo\nAl: again' })).toBe(
            '<div class="thread"><p class="msg-in">1. [Al] hi</p><p class="msg-out">2. [Bo] yo</p>' +
                '<p class="msg-in">3. [Al] again</p></div>'
        );
    });

    it('keeps the old one-paragraph-per-line behavior of <p>{{selection}}</p>', () => {
        expect(
            renderStyleTemplate(
                '<div class="card"><p class="line">{{selection|Write…}}</p></div>',
                {
                    selection: 'one\ntwo',
                }
            )
        ).toBe('<div class="card"><p class="line">one</p><p class="line">two</p></div>');
        expect(
            renderStyleTemplate('<div class="card"><p class="line">{{selection|Write…}}</p></div>')
        ).toBe('<div class="card"><p class="line">Write…</p></div>');
    });

    it('sanitizes the result with AO3’s rules', () => {
        expect(
            renderStyleTemplate('<p onclick="x()">{{selection}}</p><script>bad()</script>', {
                selection: 'ok',
            })
        ).toBe('<p>ok</p>');
    });

    it('tells authors about template mistakes', () => {
        expect(lintStyleTemplate('{{#if x}}a', [{ key: 'x', label: 'x' }])).toEqual([
            '{{#if}} is never closed.',
        ]);
        expect(lintStyleTemplate('<p>{{note}} {{speaker}} {{alt:a|b}}</p>')).toEqual([
            '{{note}} isn’t a field of this style. Add a field called “note”.',
            '{{speaker}} only works inside {{#lines}}…{{/lines}}.',
            '{{alt:…}} only works inside {{#lines}}…{{/lines}}.',
        ]);
        expect(lintStyleTemplate(findPieceById('chat')!.templateHtml!)).toEqual([]);
    });

    it('reads values back out of rendered HTML, including toggles', () => {
        const translate = findPieceById('translate')!;
        for (const parens of [true, false]) {
            const html = renderStyleTemplate(translate.templateHtml!, {
                selection: 'Je t’aime',
                fields: translate.fields,
                values: { translation: 'I <3 you', parens },
            });
            expect(matchStyleTemplate(translate.templateHtml!, translate.fields!, html)).toEqual({
                selection: 'Je t’aime',
                values: { translation: 'I <3 you', parens },
            });
        }
        expect(
            matchStyleTemplate(translate.templateHtml!, translate.fields!, '<span>x</span>')
        ).toBe(null);
    });
});

describe('built-in styles are ordinary style data', () => {
    it('every built-in passes the same checks as a style pack a user writes', () => {
        const pack = {
            eo3: 'styles',
            version: 1,
            title: 'Built-ins',
            styles: CSS_PIECES.map((piece) => ({
                id: piece.id,
                label: piece.label,
                description: piece.description,
                kind: piece.kind,
                className: piece.className,
                extraClasses: piece.extraClasses,
                previewSample: piece.previewSample,
                css: piece.css,
                templateHtml: piece.templateHtml,
                fields: piece.fields,
            })),
        };
        const parsed = parseStylePackFile(JSON.stringify(pack));
        expect(parsed.styles).toHaveLength(CSS_PIECES.length);
        for (const [i, piece] of CSS_PIECES.entries()) {
            const style = parsed.styles[i];
            expect(style.templateHtml).toBe(piece.templateHtml);
            expect(style.fields).toEqual(piece.fields);
            if (piece.templateHtml)
                expect(lintStyleTemplate(piece.templateHtml, piece.fields)).toEqual([]);
        }
    });

    it('a user-made inline template works like Translate on hover in the editor', () => {
        const style = normalizeStyleEntry({
            label: 'Footnote',
            kind: 'inline',
            className: 'my-note',
            css: '.my-note .my-note-text { display: none; }',
            templateHtml:
                '<span class="my-note">{{selection}}<sup>{{#if star}}*{{/if}}</sup><span class="my-note-text">{{note}}</span></span>',
            fields: [
                { key: 'selection', label: 'Word', required: true },
                { key: 'note', label: 'Note', required: true },
                { key: 'star', label: 'Show a star', type: 'toggle', default: true },
            ],
        });
        const piece: CssPiece = libraryStyleToPiece({ id: 'n1', style });
        setInlineTemplateLibrary([piece]);
        try {
            const html = renderInlineTemplate(piece, 'tea', { note: 'Earl Grey', star: true });
            const editor = new Editor({
                extensions: createEo3Extensions(),
                content: `<p>Have some ${html} now.</p>`,
            });
            try {
                // Saved and reopened, it is still one unit whose fields can be read back.
                const saved = editor.getHTML();
                expect(saved).toBe(`<p>Have some ${html} now.</p>`);
                let node: any = null;
                editor.state.doc.descendants((n) => {
                    if (n.type.name === 'inlineTemplate') node = n;
                });
                expect(node.attrs.styleId).toBe('custom-n1');
                expect(readInlineTemplate(piece, node.attrs.html)).toEqual({
                    selection: 'tea',
                    values: { note: 'Earl Grey', star: true },
                });
                // Removing it keeps its text.
                editor.commands.setNodeSelection(11);
                expect(editor.commands.removeInlineTemplate()).toBe(true);
                expect(editor.getHTML()).toBe('<p>Have some tea now.</p>');
            } finally {
                editor.destroy();
            }
        } finally {
            setInlineTemplateLibrary([]);
        }
    });

    it('rejects fields a template can’t use', () => {
        expect(() =>
            normalizeStyleEntry({
                label: 'X',
                kind: 'template',
                className: 'x',
                templateHtml: '<p>{{a}}</p>',
                fields: [{ key: 'text', label: 'T' }],
            })
        ).toThrow(/reserved inside \{\{#lines\}\}/);
        expect(() =>
            normalizeStyleEntry({
                label: 'X',
                kind: 'template',
                className: 'x',
                templateHtml: '<p>{{a}}</p>',
                fields: [
                    { key: 'a', label: 'A' },
                    { key: 'a', label: 'B' },
                ],
            })
        ).toThrow(/used twice/);
    });
});
