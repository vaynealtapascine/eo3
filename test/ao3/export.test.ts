import { describe, expect, it } from 'vitest';
import { exportWork } from '../../src/targets/ao3/export';
import { PartExportInput } from '../../src/targets/types';
import {
    diffSkinRules,
    liftedSkinRules,
    removeLiftedSkinRules,
} from '../../src/targets/delivery/skin-record';
import { renderAo3Content } from '../../src/targets/ao3/render';

const part = (id: string, source: string, css = ''): PartExportInput => ({
    id,
    title: '',
    source,
    html: null,
    css,
});

function run(parts: PartExportInput[], workCss = '') {
    const errors: { id: string; props: any }[] = [];
    const out = exportWork({ parts, workCss, config: {} }, (id, props) =>
        errors.push({ id, props })
    );
    return { out, errors };
}

describe('AO3 export over a work', () => {
    it('emits HTML per chapter and one Work Skin with every chapter’s lifted styles', () => {
        const { out, errors } = run(
            [
                part('a', '<p style="font-weight:bold">one</p>'),
                part('b', '<p style="color:red">two</p><p style="font-weight: bold">again</p>'),
            ],
            '.note { font-style: italic; }'
        );
        expect(errors).toEqual([]);
        expect(out.parts.get('a')!.get('html')).toBe('<p class="eo3-lenkkc">one</p>');
        expect(out.parts.get('b')!.get('html')).toBe(
            '<p class="eo3-h66u19">two</p><p class="eo3-lenkkc">again</p>'
        );
        expect(renderAo3Content(out.parts.get('a')!.get('html')!).html).toBe(
            out.parts.get('a')!.get('html')
        );
        expect(out.work.get('css')).toBe(
            [
                '#workskin .note {\n  font-style: italic;\n}',
                '#workskin .eo3-h66u19 {\n  color: red;\n}',
                '#workskin .eo3-lenkkc {\n  font-weight: bold;\n}',
            ].join('\n\n')
        );
    });

    it('does not depend on chapter order', () => {
        const a = part('a', '<p style="font-weight:bold">one</p>');
        const b = part('b', '<p style="color:red">two</p>');
        expect(run([a, b]).out.work.get('css')).toBe(run([b, a]).out.work.get('css'));
    });

    it('includes chapter-only CSS in the skin', () => {
        const { out } = run([part('a', 'one'), part('b', 'two', '.only-b { color: blue; }')]);
        expect(out.work.get('css')).toContain('#workskin .eo3-part-b .only-b');
        expect(out.work.get('css')).not.toContain('#workskin .only-b {');
        expect(out.parts.get('a')!.get('html')).toBe('<p>one</p>');
        expect(out.parts.get('b')!.get('html')).toBe('<div class="eo3-part-b"><p>two</p></div>');
    });

    it('scopes each CSS module to exactly the parts it reaches, in source order', () => {
        const parts = [part('a', 'one'), part('b', 'two'), part('c', 'three')];
        const errors: string[] = [];
        const out = exportWork(
            {
                parts,
                workCss: '.all { color: black; }',
                cssSources: [
                    { id: 'first', css: '.pair, p { color: red; }', partIds: ['a', 'c'] },
                    { id: 'shared', css: '.all { color: black; }', partIds: ['a', 'b', 'c'] },
                    {
                        id: 'second',
                        css: '@media screen { .only { color: blue; } }',
                        partIds: ['b'],
                    },
                ],
                config: {},
            },
            (id) => errors.push(id)
        );
        const skin = out.work.get('css')!;
        expect(skin).toContain('#workskin .eo3-part-a .pair,\n#workskin .eo3-part-a p');
        expect(skin).toContain('#workskin .eo3-part-c .pair,\n#workskin .eo3-part-c p');
        expect(skin).toContain('#workskin .all');
        expect(skin).toContain('#workskin .eo3-part-b .only');
        expect(skin.indexOf('.eo3-part-a .pair')).toBeLessThan(skin.indexOf('.all'));
        expect(skin.indexOf('.all')).toBeLessThan(skin.indexOf('.eo3-part-b .only'));
        expect(errors).toEqual(['css-media-flattened']);
    });

    it('keeps lifted styles still referenced by posted HTML after their source is removed', () => {
        const original = run([part('a', '<p style="color:red">old</p>')]);
        const originalCss = original.out.work.get('css')!;
        const record = liftedSkinRules(originalCss);
        expect(Object.keys(record)).toEqual(['eo3-h66u19']);

        const posted = {
            ...part('a', '<p>new</p>'),
            posted: {
                at: '2026-09-26',
                classes: ['eo3-h66u19'],
                htmlHash: 'old',
                skinCss: originalCss,
            },
        };
        const retained = exportWork(
            { parts: [posted], workCss: '', skinRecord: record, config: {} },
            () => {}
        );
        expect(retained.work.get('css')).toBe(originalCss);
        expect(diffSkinRules(originalCss, retained.work.get('css')!)).toEqual({
            added: 0,
            removed: 0,
        });

        const noLongerPosted = exportWork(
            { parts: [part('a', '<p>new</p>')], workCss: '', skinRecord: record, config: {} },
            () => {}
        );
        expect(noLongerPosted.work.get('css')).toBe('');
        expect(diffSkinRules(originalCss, noLongerPosted.work.get('css')!)).toEqual({
            added: 0,
            removed: 1,
        });
    });

    it('warns when the same selector has different declarations across parts', () => {
        const parts = [part('a', 'one'), part('b', 'two'), part('c', 'three')];
        const errors: { id: string; props: any }[] = [];
        exportWork(
            {
                parts,
                workCss: '',
                cssSources: [
                    { id: 'a', css: '.note { color: red; }', partIds: ['a'] },
                    { id: 'b', css: '.note { color: blue; }', partIds: ['b'] },
                    { id: 'c', css: '.note { color: red; }', partIds: ['c'] },
                ],
                config: {},
            },
            (id, props) => errors.push({ id, props })
        );
        expect(errors).toContainEqual({
            id: 'cross-part-css-conflict',
            props: { selector: '.note', parts: [1, 2] },
        });
        expect(errors.filter((e) => e.id === 'cross-part-css-conflict')).toHaveLength(1);
    });

    it('round-trips an imported canonical Work Skin without duplicating protected rules', () => {
        const skin = [
            '#workskin .note {\n  font-style: italic;\n}',
            '#workskin .eo3-h66u19 {\n  color: red;\n}',
        ].join('\n\n');
        const record = liftedSkinRules(skin);
        expect(record).toHaveProperty('eo3-h66u19');
        const input = {
            parts: [part('a', '<p class="eo3-h66u19">old</p>')],
            workCss: skin,
            skinRecord: record,
            protectedSkinClasses: ['eo3-h66u19'],
            config: {},
        };
        expect(exportWork(input, () => {}).work.get('css')).toBe(skin);
        expect(diffSkinRules(skin, exportWork(input, () => {}).work.get('css')!)).toEqual({
            added: 0,
            removed: 0,
        });
        expect(liftedSkinRules('.eo3-h66u19 { color: red; }')).toHaveProperty('eo3-h66u19');

        const withoutRule = removeLiftedSkinRules(skin, ['eo3-h66u19']);
        expect(withoutRule).toBe('#workskin .note {\n  font-style: italic;\n}');
        expect(exportWork({ ...input, workCss: withoutRule }, () => {}).work.get('css')).toBe(skin);
        expect(
            exportWork(
                { ...input, workCss: withoutRule, skinRecord: {}, protectedSkinClasses: [] },
                () => {}
            ).work.get('css')
        ).toBe(withoutRule);
    });
});
