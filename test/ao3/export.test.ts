import { describe, expect, it } from 'vitest';
import { exportWork } from '../../src/targets/ao3/export';
import { PartExportInput } from '../../src/targets/types';

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
        expect(out.parts.get('a')!.get('html')).toBe(
            '<div class="eo3-part-a"><p class="eo3-lenkkc">one</p></div>'
        );
        expect(out.parts.get('b')!.get('html')).toBe(
            '<div class="eo3-part-b"><p class="eo3-h66u19">two</p><p class="eo3-lenkkc">again</p></div>'
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
});
