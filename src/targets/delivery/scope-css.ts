import { parse, generate, walk, CssNode } from 'css-tree';

/**
 * Prefixes every style rule's selectors with `scope`. `@keyframes` and
 * `@font-face` blocks are skipped; `@media`/`@supports` are descended into.
 *
 * When `outerScope` (such as `#workskin`) is given and differs from `scope`, selectors that
 * already begin with `outerScope` receive `scope` *inside* `outerScope` (`#workskin .x` →
 * `#workskin .eo3-part-a .x`) instead of before it, so descendant scoping never produces an
 * impossible `.eo3-part-a #workskin .x` selector.
 */
export function scopeCss(css: string, scope: string, outerScope?: string): string {
    if (!scope) return css;

    let ast;
    try {
        ast = parse(css);
    } catch {
        return css; // leave unparseable CSS untouched rather than dropping it
    }

    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Skip selectors already under the scope (`#workskin .x`), but not `#workskin-note`.
    const alreadyScoped = new RegExp('^' + escapeRe(scope) + '(?![\\w-])');
    const outerPrefix =
        outerScope && outerScope !== scope
            ? new RegExp('^(' + escapeRe(outerScope) + '(?![\\w-])[^\\s>+~]*)(.*)$')
            : null;

    const rewrite = (sel: string): string => {
        if (alreadyScoped.test(sel)) return sel;
        const match = outerPrefix?.exec(sel);
        if (match) {
            const [, outer, rest] = match;
            if (!rest) return `${outer} ${scope}`;
            if (alreadyScoped.test(rest.replace(/^[\s>+~]+/, ''))) return sel;
            return `${outer} ${scope}${rest}`;
        }
        return `${scope} ${sel}`;
    };

    walk(ast, {
        visit: 'Rule',
        enter: function (node: CssNode) {
            if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;

            const ctx = this as unknown as { atrule?: { name?: string } | null };
            const atName = (ctx.atrule?.name ?? '').toLowerCase();
            if (atName.endsWith('keyframes') || atName === 'font-face') return;

            const scoped = node.prelude.children
                .toArray()
                .map((sel) => rewrite(generate(sel)))
                .join(', ');
            node.prelude = { type: 'Raw', value: scoped };
        },
    });

    return generate(ast);
}
