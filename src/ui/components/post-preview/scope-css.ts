import { parse, generate, walk, CssNode } from 'css-tree';

/**
 * Prefixes every style rule's selectors with `scope` (as a descendant), so CSS injected into
 * the preview applies only within the mockup and gains the scope's specificity. This mirrors
 * how AO3 wraps a Work Skin under `#workskin`: the ID prefix both scopes the rules and lets
 * them win over the surrounding page styles. Rules inside `@keyframes`/`@font-face` are left
 * untouched (their `from`/`to`/`0%` blocks aren't real selectors); `@media`/`@supports`
 * blocks are descended into so their inner rules get scoped too.
 */
export function scopeCss(css: string, scope: string): string {
    if (!scope) return css;

    let ast;
    try {
        ast = parse(css);
    } catch {
        return css; // leave unparseable CSS untouched rather than dropping it
    }

    walk(ast, {
        visit: 'Rule',
        enter: function (node: CssNode) {
            if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;

            const atName = (this.atrule?.name ?? '').toLowerCase();
            if (atName.endsWith('keyframes') || atName === 'font-face') return;

            const scoped = node.prelude.children
                .toArray()
                .map((sel) => `${scope} ${generate(sel)}`)
                .join(', ');
            node.prelude = { type: 'Raw', value: scoped };
        },
    });

    return generate(ast);
}
