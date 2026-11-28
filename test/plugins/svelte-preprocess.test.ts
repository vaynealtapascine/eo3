import { describe, expect, it } from 'vitest';
import { compile as compileLegacy, preprocess as preprocessLegacy } from 'svelte-legacy/compiler';
// svelte-v4 and svelte-v5 are npm aliases whose types declare `svelte/compiler`, so TypeScript
// can't resolve them under these names (the worker importing them is plain JavaScript).
// @ts-expect-error
import { compile as compileV4, preprocess as preprocessV4 } from 'svelte-v4/compiler';
// @ts-expect-error
import { compile as compileV5, preprocess as preprocessV5 } from 'svelte-v5/compiler';
import { preprocessComponent } from '../../src/plugins/source/svelte-preprocess';

const VERSIONS = [
    { name: 'Svelte 3', preprocess: preprocessLegacy, compile: compileLegacy, stripTypes: true },
    { name: 'Svelte 4', preprocess: preprocessV4, compile: compileV4, stripTypes: true },
    {
        name: 'Svelte 5',
        preprocess: preprocessV5,
        compile: (code: string, opts: object) => compileV5(code, { ...opts, generate: 'client' }),
        stripTypes: false,
    },
] as const;

/** The component's CSS as its compiler emits it (scoped, minified). */
async function componentCss(version: typeof VERSIONS[number], source: string) {
    const code = await preprocessComponent(version.preprocess as any, source, 'Card.svelte', {
        stripTypes: version.stripTypes,
    });
    return (version.compile as any)(code, { filename: 'Card.svelte' }).css?.code ?? '';
}

const SCSS = `<div class="card"><p class="title">Hi</p></div>

<style lang="scss">
    $accent: #c33;
    $gap: 3px;
    .card {
        border: 1px solid $accent;
        .title { margin: $gap * 2; }
        :global(.conversation-section) { margin: 0; }
    }
</style>`;

// Each version writes scoped selectors its own way: Svelte 3 and 4 may repeat the class
// (`.card.svelte-x.svelte-x`), Svelte 5 wraps descendants in `:where(.svelte-x)`.
const SCOPED = String.raw`(?:\.svelte-[\w-]+|:where\(\.svelte-[\w-]+\))+`;

describe('Sass in Svelte components', () => {
    for (const version of VERSIONS) {
        it(`compiles <style lang="scss"> and scopes the result (${version.name})`, async () => {
            const css = await componentCss(version, SCSS);
            expect(css).toMatch(
                new RegExp(String.raw`\.card${SCOPED}\s*\{\s*border:\s*1px solid #c33`)
            );
            expect(css).toMatch(
                new RegExp(String.raw`\.card${SCOPED} \.title${SCOPED}\s*\{\s*margin:\s*6px`)
            );
            // :global() inside Sass nesting stays unscoped.
            expect(css).toMatch(
                new RegExp(String.raw`\.card${SCOPED} \.conversation-section\s*\{`)
            );
            expect(css).not.toContain('$');
        });
    }

    it('compiles indented <style lang="sass"> even when the whole block is indented', async () => {
        const css = await componentCss(
            VERSIONS[1],
            `<p class="note">x</p>
<style lang="sass">
    $size: 2px
    .note
        padding: $size * 2
</style>`
        );
        expect(css).toMatch(/\.note\.svelte-[\w-]+\s*\{\s*padding:\s*4px;?\s*\}/);
    });

    it('accepts the older type="text/scss"', async () => {
        const css = await componentCss(
            VERSIONS[1],
            `<p class="a">x</p><style type="text/scss">.a { &:hover { color: red; } }</style>`
        );
        expect(css).toMatch(/\.a\.svelte-[\w-]+:hover\s*\{/);
    });

    it('names the component when the Sass is wrong', async () => {
        await expect(
            preprocessComponent(
                preprocessV4 as any,
                `<style lang="scss">.a { color: $missing; }</style>`,
                'Card.svelte',
                { stripTypes: true }
            )
        ).rejects.toThrow(/Card\.svelte: in <style lang="scss">: .*Undefined variable/);
    });

    it('still strips TypeScript alongside Sass for Svelte 3 and 4', async () => {
        const code = await preprocessComponent(
            preprocessV4 as any,
            `<script lang="ts">let n: number = 1;</script><p class="a">{n}</p>
<style lang="scss">.a { b & { color: red; } }</style>`,
            'Card.svelte',
            { stripTypes: true }
        );
        expect(code).toContain('let n = 1;');
        expect(code).toMatch(/b \.a\s*\{\s*color: red;/);
    });

    it('leaves components without Sass or TypeScript untouched', async () => {
        const source = `<script>let n = 1;</script><style>.a { color: red; }</style>`;
        for (const version of VERSIONS) {
            const code = await preprocessComponent(
                version.preprocess as any,
                source,
                'Card.svelte',
                { stripTypes: version.stripTypes }
            );
            expect(code).toBe(source);
        }
    });
});
