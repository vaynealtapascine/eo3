import { generate, parse, walk, type CssNode } from 'css-tree';

const WORKSKIN_ID_RE = /#workskin(?![\w-])/gi;
const ROOT_SELECTOR_RE = /^(?:html|body|:root)(?=$|[\s>+~.:[#])/i;

/**
 * Rewrites authored Work Skin / chapter CSS so every rule applies strictly inside `scopeSelector`
 * (the TipTap `.ProseMirror` canvas wrapper) and can never leak into the surrounding eo3 UI.
 *
 * - `#workskin .foo` becomes `${scopeSelector} .foo`; bare `#workskin` becomes `${scopeSelector}`.
 * - Unscoped `.foo` or `blockquote` becomes `${scopeSelector} .foo` / `${scopeSelector} blockquote`.
 * - `@keyframes` and `@font-face` blocks are preserved; `@media` / `@supports` are descended into.
 * - Unparseable CSS returns `''` rather than injecting broken/unscoped rules into the document.
 */
export function scopeCanvasCss(css: string, scopeSelector: string): string {
    if (!css.trim() || !scopeSelector) return '';

    let ast: CssNode;
    try {
        ast = parse(css);
    } catch {
        return '';
    }

    const escapedScope = scopeSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alreadyScoped = new RegExp('^' + escapedScope + '(?![\\w-])');

    walk(ast, {
        visit: 'Rule',
        enter: function (node: CssNode) {
            if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;

            const ctx = this as unknown as { atrule?: { name?: string } | null };
            const atName = (ctx.atrule?.name ?? '').toLowerCase();
            if (atName.endsWith('keyframes') || atName === 'font-face') return;

            const scoped = node.prelude.children
                .toArray()
                .map((sel) => rewriteSelector(generate(sel).trim(), scopeSelector, alreadyScoped))
                .filter(Boolean)
                .join(', ');

            node.prelude = { type: 'Raw', value: scoped || scopeSelector };
        },
    });

    return generate(ast);
}

function rewriteSelector(selector: string, scopeSelector: string, alreadyScoped: RegExp): string {
    if (!selector) return '';
    if (alreadyScoped.test(selector)) return selector;

    if (WORKSKIN_ID_RE.test(selector)) {
        WORKSKIN_ID_RE.lastIndex = 0;
        return selector.replace(WORKSKIN_ID_RE, scopeSelector);
    }

    if (ROOT_SELECTOR_RE.test(selector)) {
        return selector.replace(ROOT_SELECTOR_RE, scopeSelector);
    }

    return `${scopeSelector} ${selector}`;
}

/**
 * Extracts unique CSS class names authored in a work's stylesheet, excluding generated `eo3-*`
 * classes and any names in `exclude` (such as built-in `fx-*` piece classes).
 */
export function extractWorkCssClasses(
    css: string,
    exclude: ReadonlySet<string> = new Set()
): string[] {
    if (!css.trim()) return [];

    let ast: CssNode;
    try {
        ast = parse(css);
    } catch {
        return [];
    }

    const seen = new Set<string>();
    walk(ast, {
        visit: 'ClassSelector',
        enter(node: CssNode) {
            if (node.type !== 'ClassSelector') return;
            const name = node.name;
            if (!name || name.startsWith('eo3-') || exclude.has(name)) return;
            seen.add(name);
        },
    });

    return [...seen];
}
