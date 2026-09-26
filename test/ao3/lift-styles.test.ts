import { describe, expect, it } from 'vitest';
import { liftInlineStyles, ClassCollision } from '../../src/targets/ao3/render/lift-styles';

function lift(html: string) {
    const root = document.createElement('div');
    root.innerHTML = html;
    const collisions: ClassCollision[] = [];
    const css = liftInlineStyles(root, (c) => collisions.push(c));
    return { css, html: root.innerHTML, collisions };
}

const classOf = (style: string) => lift(`<p style="${style}">x</p>`).html.match(/eo3-[\w-]+/)![0];

describe('lifted class names', () => {
    // Posted chapters reference these names. If this test fails, the naming format changed and
    // every lifted class in every posted work would be renamed: don't update the expectations,
    // fix the change (or add a migration that keeps the old names).
    it.each([
        ['color: red', 'eo3-h66u19'],
        ['font-weight:bold', 'eo3-lenkkc'],
        ['color:red;font-size:2em', 'eo3-qy0dt1'],
        ['display: inline-flex; vertical-align: middle', 'eo3-momd26'],
    ])('%s → %s', (style, name) => {
        expect(classOf(style)).toBe(name);
    });

    it('ignores declaration order, whitespace and property case', () => {
        expect(classOf('font-size: 2em ;  COLOR:red;')).toBe(classOf('color:red;font-size:2em'));
    });

    it('keeps only the last value of a repeated property', () => {
        expect(classOf('color:red;color:blue')).toBe(classOf('color:blue'));
        expect(classOf('color:red;color:blue')).not.toBe(classOf('color:blue;color:red'));
    });

    it('keeps written order when a shorthand and its longhand are both present', () => {
        const blue = 'background: red; background-color: blue';
        const red = 'background-color: blue; background: red';
        expect(classOf(blue)).not.toBe(classOf(red));
        expect(lift(`<p style="${blue}">x</p>`).css).toMatch(
            /\{ background: red; background-color: blue \}$/
        );
    });
});

describe('lifted rules', () => {
    it('are deduplicated, sorted by class name and independent of document order', () => {
        const a = lift(
            '<p style="font-weight:bold">1</p><p style="color: red">2</p><i style="color:red">3</i>'
        );
        const b = lift('<p style="color:red">2</p><p style="font-weight: bold">1</p>');
        expect(a.css).toBe('.eo3-h66u19 { color: red }\n.eo3-lenkkc { font-weight: bold }');
        expect(b.css).toBe(a.css);
    });

    it('report a hash collision and keep the two styles apart', () => {
        // Found by search: both hash to vzhq5q.
        const { css, collisions } = lift(
            '<p style="color:#0089db">1</p><p style="color:#047828">2</p>'
        );
        expect(collisions).toEqual([
            {
                kind: 'class-collision',
                className: 'eo3-vzhq5q',
                styles: ['color:#0089db', 'color:#047828'],
            },
        ]);
        const names = css.match(/eo3-[\w-]+/g)!;
        expect(new Set(names).size).toBe(2);
        expect(names).toContain('eo3-vzhq5q');
    });
});
