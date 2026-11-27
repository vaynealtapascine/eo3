/**
 * Compiling scripts: TypeScript type stripping, and turning a script plus the modules sent to
 * it into one program the sandbox (`script-sandbox.ts`) can run. Nothing here runs user code.
 *
 * TypeScript is only transpiled (types are removed, not checked): checking would need the full
 * compiler in the browser. Sucrase is loaded on first use.
 */

export type ScriptLanguage = 'typescript' | 'javascript';

/** A module a script can import as `./<name>`. */
export interface ScriptModule {
    code: string;
    language?: ScriptLanguage;
}

async function sucrase() {
    return (await import('sucrase')).transform;
}

/**
 * TypeScript → JavaScript with the same imports and exports. `keepUnusedImports` keeps imports
 * only used outside the script (Svelte markup uses them).
 */
export async function stripTypes(
    code: string,
    options: { filePath?: string; keepUnusedImports?: boolean } = {}
): Promise<string> {
    const transform = await sucrase();
    return transform(code, {
        transforms: ['typescript'],
        disableESTransforms: true,
        keepUnusedImports: options.keepUnusedImports,
        filePath: options.filePath,
    }).code;
}

/** One module as a CommonJS function body (`require` is the program's own resolver). */
async function toCommonJs(name: string, module: ScriptModule): Promise<string> {
    const transform = await sucrase();
    const typescript = module.language === 'typescript';
    try {
        return transform(module.code, {
            transforms: typescript ? ['typescript', 'imports'] : ['imports'],
            disableESTransforms: true,
            production: true,
            filePath: name,
        }).code;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${name}: ${message}`);
    }
}

/** What the program reports back through `__eo3Done`. */
export type ScriptResult =
    | { ok: true; kind: 'text'; value: string }
    | { ok: true; kind: 'json'; value: string; valueType: string }
    | { ok: true; kind: 'undefined' }
    | { ok: false; error: string; stack?: string };

const MAIN = '\0main';

/**
 * One program running `main` with `modules` importable as `./<name>`. Evaluated with a
 * `__eo3Done(result: ScriptResult)` function in scope, it calls that once.
 *
 * `main`'s default export is the result: text, or a function (sync or async) returning it,
 * which is called with every input by name. Imports are only the modules given here.
 */
export async function buildScriptProgram(
    main: ScriptModule,
    modules: Map<string, ScriptModule>
): Promise<string> {
    const defs: string[] = [];
    for (const [name, module] of modules) {
        defs.push(
            `${JSON.stringify(name)}: function (exports, require, module) {\n${await toCommonJs(
                `./${name}`,
                module
            )}\n}`
        );
    }
    const mainCode = await toCommonJs('script', main);
    defs.push(`${JSON.stringify(MAIN)}: function (exports, require, module) {\n${mainCode}\n}`);

    return `"use strict";
const __eo3Modules = {
${defs.join(',\n')}
};
const __eo3Names = ${JSON.stringify([...modules.keys()])};
const __eo3Cache = Object.create(null);
function __eo3Resolve(spec) {
    if (typeof spec !== 'string' || !/^\\.\\.?\\//.test(spec)) {
        throw new Error('Scripts can only import the modules sent to them, as "./<name>"; "' + spec + '" is not one.');
    }
    const name = spec.replace(/^\\.\\//, '');
    if (__eo3Names.includes(name)) return name;
    const bare = name.replace(/\\.(m?[jt]s|json)$/, '');
    if (__eo3Names.includes(bare)) return bare;
    throw new Error('Cannot find "' + spec + '". Send a module to this script as a named input called "' + bare + '" to import it.' + (__eo3Names.length ? ' Available: ' + __eo3Names.map((n) => '"./' + n + '"').join(', ') + '.' : ''));
}
function __eo3Load(name) {
    if (name in __eo3Cache) return __eo3Cache[name].exports;
    const module = { exports: {} };
    __eo3Cache[name] = module;
    __eo3Modules[name].call(module.exports, module.exports, (spec) => __eo3Load(__eo3Resolve(spec)), module);
    return module.exports;
}
function __eo3Inputs() {
    const inputs = {};
    for (const name of __eo3Names) {
        Object.defineProperty(inputs, name, {
            enumerable: true,
            get() {
                const exports = __eo3Load(name);
                return exports && exports.__esModule && 'default' in exports ? exports.default : exports;
            },
        });
    }
    return inputs;
}
(async () => {
    try {
        const exports = __eo3Load(${JSON.stringify(MAIN)});
        if (!exports || !('default' in exports)) {
            throw new Error('The script has no default export. End it with "export default" and the text it makes, or a function that returns it.');
        }
        let value = exports.default;
        if (typeof value === 'function') value = value(__eo3Inputs());
        value = await value;
        if (typeof value === 'string') {
            __eo3Done({ ok: true, kind: 'text', value });
        } else if (value === undefined) {
            __eo3Done({ ok: true, kind: 'undefined' });
        } else {
            const json = JSON.stringify(value);
            if (json === undefined) throw new Error('The script returned a ' + typeof value + ', which is not text or data.');
            __eo3Done({ ok: true, kind: 'json', value: json, valueType: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value });
        }
    } catch (err) {
        __eo3Done({
            ok: false,
            error: err && err.message ? (err.name && err.name !== 'Error' ? err.name + ': ' : '') + err.message : String(err),
            stack: err && err.stack ? String(err.stack) : undefined,
        });
    }
})();
`;
}

/** Runs a built program directly, without a sandbox. Only for tests and trusted code. */
export function runProgramUnsandboxed(program: string): Promise<ScriptResult> {
    return new Promise((resolve) => {
        new Function('__eo3Done', program)(resolve);
    });
}
