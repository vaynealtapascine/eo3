import { transform as sucrase } from 'sucrase';

/** The `preprocess` function every Svelte version's compiler exports (3, 4 and 5 agree on it). */
type SveltePreprocess = (
    source: string,
    preprocessor: {
        script?: (options: BlockOptions) => Promise<Processed | void> | Processed | void;
        style?: (options: BlockOptions) => Promise<Processed | void> | Processed | void;
    },
    options: { filename: string }
) => Promise<{ code: string }>;

interface BlockOptions {
    content: string;
    attributes: Record<string, string | boolean>;
    filename?: string;
}

interface Processed {
    code: string;
}

const TS_SCRIPT_PATTERN = /<script\b[^>]*\blang\s*=\s*["']?(ts|typescript)\b/i;
const SASS_STYLE_PATTERN = /<style\b[^>]*\b(lang|type)\s*=\s*["']?(text\/)?(scss|sass)\b/i;

/**
 * Prepares a component for the compiler:
 *
 * -   With `stripTypes` (Svelte 3 and 4, which don't read TypeScript), removes the types from
 *     `<script lang="ts">` blocks. Imports only the markup uses are kept. (Svelte 5 reads
 *     TypeScript itself.)
 * -   Compiles `<style lang="scss">` and `<style lang="sass">` to CSS with the Sass compiler
 *     eo3's Sass module uses, so Svelte scopes the result as usual. Sass loads only when a
 *     component asks for it.
 */
export async function preprocessComponent(
    preprocess: SveltePreprocess,
    code: string,
    filename: string,
    { stripTypes }: { stripTypes: boolean }
): Promise<string> {
    const typescript = stripTypes && TS_SCRIPT_PATTERN.test(code);
    const sass = SASS_STYLE_PATTERN.test(code);
    if (!typescript && !sass) return code;
    const result = await preprocess(
        code,
        {
            ...(typescript ? { script: stripScriptTypes } : {}),
            ...(sass ? { style: compileSassStyle } : {}),
        },
        { filename }
    );
    return result.code;
}

function stripScriptTypes({ content, attributes, filename }: BlockOptions): Processed | void {
    if (attributes.lang !== 'ts' && attributes.lang !== 'typescript') return;
    return {
        code: sucrase(content, {
            transforms: ['typescript'],
            disableESTransforms: true,
            keepUnusedImports: true,
            filePath: filename,
        }).code,
    };
}

/** `lang="scss"`, `lang="sass"`, or the older `type="text/scss"`; null for anything else. */
function sassSyntax(attributes: BlockOptions['attributes']): 'scss' | 'sass' | null {
    const lang = String(attributes.lang ?? attributes.type ?? '')
        .toLowerCase()
        .replace(/^text\//, '');
    return lang === 'scss' || lang === 'sass' ? lang : null;
}

let sassCompiler: Promise<typeof import('sass')> | null = null;

async function compileSassStyle({
    content,
    attributes,
    filename,
}: BlockOptions): Promise<Processed | void> {
    const syntax = sassSyntax(attributes);
    if (!syntax) return;
    sassCompiler ??= import('sass');
    const { compileString } = await sassCompiler;
    try {
        const result = compileString(syntax === 'sass' ? dedent(content) : content, {
            syntax: syntax === 'sass' ? 'indented' : 'scss',
        });
        return { code: result.css };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${filename}: in <style lang="${syntax}">: ${message}`);
    }
}

/**
 * Removes the indentation every line shares. Indented Sass reads indentation as nesting, and a
 * `<style>` block's contents are usually indented as a whole.
 */
function dedent(text: string): string {
    const lines = text.split('\n');
    const indents = lines
        .filter((line) => line.trim())
        .map((line) => line.match(/^[ \t]*/)![0].length);
    const common = indents.length ? Math.min(...indents) : 0;
    return lines.map((line) => line.slice(Math.min(common, line.length))).join('\n');
}
