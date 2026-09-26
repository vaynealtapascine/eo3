import { describe, expect, it } from 'vitest';
import { createProfileTarget } from '../../src/targets/profile/target';
import { newProfile, parseProfile, TargetProfile } from '../../src/targets/profile/types';
import { PartExportInput } from '../../src/targets/types';

function run(profile: TargetProfile, source: string, workCss = '') {
    const target = createProfileTarget(profile);
    const errors: { id: string; props: any }[] = [];
    const part: PartExportInput = { id: 'p', title: '', source, html: null, css: '' };
    const out = target.export({ parts: [part], workCss, config: {} }, (id, props) =>
        errors.push({ id, props })
    );
    return { html: out.parts.get('p')!.get('html')!, css: out.work.get('css'), errors };
}

describe('parseProfile', () => {
    it('accepts a new profile and rejects malformed ones with a reason', () => {
        expect(parseProfile(newProfile('mine'))).toMatchObject({ id: 'mine', delivery: 'inline' });
        expect(parseProfile({ ...newProfile('x'), delivery: 'fax' })).toMatch(/delivery/);
        expect(parseProfile({ ...newProfile('x'), id: 'has space' })).toMatch(/id/);
        expect(parseProfile({ ...newProfile('x'), elements: 'p' })).toMatch(/elements/);
    });
});

describe('a target built from a profile', () => {
    it('keeps only the allowed elements, attributes and protocols', () => {
        const { html } = run(
            newProfile('s'),
            '<p onclick="x()">hi <marquee>there</marquee></p><a href="javascript:x()">link</a>' +
                '<script>bad()</script>'
        );
        expect(html).toBe('<p>hi there</p><a>link</a>');
    });

    it('inlines CSS and drops properties the site doesn’t allow', () => {
        const profile = { ...newProfile('s'), cssProperties: ['color'] };
        const { html, errors } = run(
            profile,
            '<p class="note">hi</p>',
            '.note { color: red; position: fixed; }'
        );
        expect(html).toBe('<p style="color:red">hi</p>');
        expect(errors).toContainEqual({
            id: 'css-property-dropped',
            props: { property: 'position' },
        });
    });

    it('shares one stylesheet with lifted classes for shared-stylesheet sites', () => {
        const profile: TargetProfile = {
            ...newProfile('s'),
            delivery: 'shared-stylesheet',
            attributes: { all: ['class'] },
        };
        const { html, css } = run(
            profile,
            '<p style="color: red">hi</p>',
            '.note { color: blue; }'
        );
        expect(html).toBe('<p class="eo3-h66u19">hi</p>');
        expect(css).toContain('.eo3-h66u19');
        expect(css).toContain('.note');
    });

    it('embeds a <style> block for embedded-style sites', () => {
        const profile: TargetProfile = { ...newProfile('s'), delivery: 'embedded-style' };
        const { html } = run(profile, '<p>hi</p>', '.note { color: red; }');
        expect(html).toMatch(/^<style>\n\.note ?\{ ?color: ?red;? ?\}\n<\/style>\n<p>hi<\/p>$/);
    });

    it('drops all styling for plain sites and says so', () => {
        const profile: TargetProfile = { ...newProfile('s'), delivery: 'plain' };
        const { html, errors } = run(profile, '<p style="color:red">hi</p>', '.x { color: red; }');
        expect(html).toBe('<p>hi</p>');
        expect(errors).toEqual([{ id: 'styling-dropped', props: { count: 2 } }]);
    });
});
