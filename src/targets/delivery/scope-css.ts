import { parse, generate, walk, CssNode } from 'css-tree';

/**
 * Prefixes every style rule's selectors with `scope`. `@keyframes` and
 * `@font-face` blocks are skipped; `@media`/`@supports` are descended into.
 */
export function scopeCss(css: string, scope: string): string {
    if (!scope) return css;

    let ast;
    try {
        ast = parse(css);
    } catch {
        return css; // leave unparseable CSS untouched rather than dropping it
    }

    // Skip selectors already under the scope (`#workskin .x`), but not `#workskin-note`.
    const alreadyScoped = new RegExp(
        '^' + scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])'
    );

    walk(ast, {
        visit: 'Rule',
        enter: function (node: CssNode) {
            if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;

            const ctx = this as unknown as { atrule?: { name?: string } | null };
            const atName = (ctx.atrule?.name ?? '').toLowerCase();
            if (atName.endsWith('keyframes') || atName === 'font-face') return;

            const scoped = node.prelude.children
                .toArray()
                .map((sel) => generate(sel))
                .map((sel) => (alreadyScoped.test(sel) ? sel : `${scope} ${sel}`))
                .join(', ');
            node.prelude = { type: 'Raw', value: scoped };
        },
    });

    return generate(ast);
}
