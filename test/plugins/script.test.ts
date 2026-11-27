import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/components/code-editor', () => ({ CodeEditor: () => null }));
// The real plugin registry pulls in every editor; these tests only need the data classes.
vi.mock('../../src/plugins', () => ({ MODULES: {} }));

import {
    CssData,
    HtmlData,
    JavascriptData,
    PlainTextData,
    canonicalMime,
    textData,
    isCssModule,
    type AnyModule,
} from '../../src/document';
import {
    buildScriptProgram,
    runProgramUnsandboxed,
    stripTypes,
    type ScriptModule,
} from '../../src/plugins/source/script-runtime';
import { scriptOutput, type ScriptPluginData } from '../../src/plugins/source/script';
import { SvelteComponentData } from '../../src/plugins/source/svelte-component';
import { SettingsModuleData } from '../../src/plugins/source/settings-values';

async function run(code: string, modules: Record<string, ScriptModule> = {}, ts = true) {
    const program = await buildScriptProgram(
        { code, language: ts ? 'typescript' : 'javascript' },
        new Map(Object.entries(modules))
    );
    return runProgramUnsandboxed(program);
}

describe('TypeScript', () => {
    it('removes types and keeps the module’s imports and exports', async () => {
        const js = await stripTypes(
            `import type { X } from './x';\nimport y from './y';\n` +
                `interface P { a: number }\nexport const f = (p: P): number => p.a + y;\n` +
                `export default f as (p: P) => number;\n`
        );
        expect(js).not.toMatch(/interface|: number|import type/);
        expect(js).toContain(`import y from './y'`);
        expect(js).toContain('export default f');
    });

    it('keeps imports only used outside the script when asked (Svelte markup)', async () => {
        const code = `import Card from './Card.svelte';\nlet n: number = 1;`;
        expect(await stripTypes(code)).not.toContain('Card');
        expect(await stripTypes(code, { keepUnusedImports: true })).toContain(
            `import Card from './Card.svelte'`
        );
    });
});

describe('scripts', () => {
    it('returns the default export’s text, from a string or a function', async () => {
        expect(await run(`export default 'a { color: red }' as string;`)).toEqual({
            ok: true,
            kind: 'text',
            value: 'a { color: red }',
        });
        expect(
            await run(`export default async (): Promise<string> => ['a', 'b'].join('-');`)
        ).toEqual({ ok: true, kind: 'text', value: 'a-b' });
    });

    it('imports named inputs as ./name and passes them to the default function', async () => {
        const settings = new SettingsModuleData({
            fields: [
                { key: 'ink', type: 'color', default: '#112233' },
                {
                    key: 'people',
                    type: 'list',
                    fields: [{ key: 'name' }],
                    default: [{ name: 'Ann' }, { name: 'Bo' }],
                },
            ],
            values: {},
        });
        const modules = {
            settings: { code: settings.contents },
            helpers: {
                code: `import s from './settings';\nexport const upper = (t: string) => t.toUpperCase() + s.ink;`,
                language: 'typescript' as const,
            },
            note: { code: `export default ${JSON.stringify('plain text')};` },
        };
        const result = await run(
            `import settings from './settings';
import { upper } from './helpers.ts';
type Person = { name: string };
export default function ({ note }: { note: string }) {
    return settings.people.map((p: Person) => upper(p.name)).join(',') + ' ' + note;
}`,
            modules
        );
        expect(result).toEqual({
            ok: true,
            kind: 'text',
            value: 'ANN#112233,BO#112233 plain text',
        });
    });

    it('reports data results, missing exports and unknown imports', async () => {
        expect(await run(`export default { a: [1, 2] };`)).toEqual({
            ok: true,
            kind: 'json',
            value: '{"a":[1,2]}',
            valueType: 'object',
        });
        expect(await run(`export default undefined;`)).toEqual({ ok: true, kind: 'undefined' });
        const missing = await run(`const x = 1;`);
        expect(missing.ok).toBe(false);
        expect(!missing.ok && missing.error).toMatch(/no default export/);
        const bad = await run(`import x from './nope';\nexport default x;`, {
            settings: { code: 'export default {}' },
        });
        expect(!bad.ok && bad.error).toMatch(/Cannot find "\.\/nope".*"\.\/settings"/);
        const pkg = await run(`import x from 'lodash';\nexport default x;`);
        expect(!pkg.ok && pkg.error).toMatch(/only import the modules sent to them/);
        const thrown = await run(`export default () => { throw new TypeError('boom'); };`);
        expect(!thrown.ok && thrown.error).toBe('TypeError: boom');
    });

    it('names the module with a syntax error', async () => {
        await expect(
            buildScriptProgram({ code: 'export default (', language: 'javascript' }, new Map())
        ).rejects.toThrow(/^script: /);
        await expect(
            buildScriptProgram(
                { code: 'export default 1', language: 'javascript' },
                new Map([['broken', { code: 'let = ;' }]])
            )
        ).rejects.toThrow(/^\.\/broken: /);
    });
});

describe('script output types', () => {
    const data = (outputType: string, name?: string): ScriptPluginData => ({
        contents: '',
        language: 'typescript',
        outputType,
        name,
    });

    it('passes text on as the chosen MIME type', () => {
        expect(scriptOutput(data('text/css'), { kind: 'text', value: 'a{}' })).toBeInstanceOf(
            CssData
        );
        expect(scriptOutput(data('text/html'), { kind: 'text', value: '<p>' })).toBeInstanceOf(
            HtmlData
        );
        expect(
            scriptOutput(data('text/javascript'), { kind: 'text', value: 'export default 1' })
        ).toBeInstanceOf(JavascriptData);
        const svelte = scriptOutput(data('svelte-component', 'Card'), {
            kind: 'text',
            value: '<p>hi</p>',
        });
        expect(svelte).toBeInstanceOf(SvelteComponentData);
        expect((svelte as SvelteComponentData).name).toBe('Card');
        const md = scriptOutput(data('text/markdown'), { kind: 'text', value: '# hi' });
        expect(md).toBeInstanceOf(PlainTextData);
        expect(md.typeId).toBe('text/markdown');
    });

    it('passes data on as a JavaScript module, and refuses it for text types', () => {
        const js = scriptOutput(data('application/javascript'), {
            kind: 'json',
            value: '[1]',
            valueType: 'array',
        });
        expect((js as JavascriptData).contents).toBe('export default [1];\n');
        expect(() =>
            scriptOutput(data('text/css'), { kind: 'json', value: '{}', valueType: 'object' })
        ).toThrow(/returned an object, but should return text \(CSS\)/);
        expect(() => scriptOutput(data('text/css'), { kind: 'undefined' })).toThrow(
            /returned nothing/
        );
    });

    it('counts as a CSS module before it renders when it outputs CSS', () => {
        const mod = (plugin: string, data: unknown) =>
            ({ plugin: { id: plugin }, data } as unknown as AnyModule);
        expect(isCssModule(mod('source.script', { outputType: 'text/css' }))).toBe(true);
        expect(isCssModule(mod('source.script', { outputType: 'text/html' }))).toBe(false);
        expect(isCssModule(mod('source.file-data', { outputMode: 'text', mime: 'text/css' }))).toBe(
            true
        );
        expect(isCssModule(mod('source.file-data', { outputMode: 'blob', mime: 'text/css' }))).toBe(
            false
        );
    });
});

describe('MIME-typed text', () => {
    it('creates the data class of a MIME type, through aliases and parameters', () => {
        expect(textData('text/css; charset=utf-8', 'a{}')).toBeInstanceOf(CssData);
        expect(textData('TEXT/HTML', '<p>')).toBeInstanceOf(HtmlData);
        expect(textData('text/javascript', '')).toBeInstanceOf(JavascriptData);
        expect(textData(undefined, 'x').typeId).toBe('text/plain');
        expect(canonicalMime('application/x-javascript')).toBe('application/javascript');
        expect(canonicalMime('')).toBe(null);
    });

    it('lets inputs accept plain text labelled with their MIME type', () => {
        const css = new PlainTextData('a { color: red }', 'text/css');
        expect(css.into(CssData)?.contents).toBe('a { color: red }');
        expect(css.into(CssData)).toBeInstanceOf(CssData);
        expect(css.into(HtmlData)).toBe(null);
        expect(css.into(PlainTextData)).toBe(css);
        expect(new PlainTextData('x').into(CssData)).toBe(null);
        expect(new PlainTextData('x', 'text/javascript').into(JavascriptData)).toBeInstanceOf(
            JavascriptData
        );
    });
});
