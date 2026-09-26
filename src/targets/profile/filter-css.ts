import { parse, generate, walk, List, ListItem, CssNode, Declaration } from 'css-tree';
import { PushError } from '../types';

/** Removes declarations whose property isn't allowed; reports each removal once per property. */
export function filterStylesheet(
    css: string,
    allowed: ReadonlySet<string>,
    pushError: PushError
): string {
    if (!css.trim()) return css;
    let ast: CssNode;
    try {
        ast = parse(css, { parseValue: false });
    } catch (err) {
        pushError('invalid-css', { message: (err as Error).message });
        return '';
    }
    const dropped = new Set<string>();
    walk(ast, {
        visit: 'Declaration',
        enter(node: Declaration, item: ListItem<CssNode>, list: List<CssNode>) {
            const property = node.property.toLowerCase();
            if (allowed.has(property) || !list) return;
            dropped.add(property);
            list.remove(item);
        },
    });
    for (const property of dropped) pushError('css-property-dropped', { property });
    return generate(ast);
}

/** The same for every `style` attribute under `root`; an attribute left empty is removed. */
export function filterStyleAttributes(
    root: ParentNode,
    allowed: ReadonlySet<string>,
    pushError: PushError
) {
    const dropped = new Set<string>();
    for (const node of root.querySelectorAll('[style]')) {
        let ast: CssNode;
        try {
            ast = parse(node.getAttribute('style')!, {
                context: 'declarationList',
                parseValue: false,
            });
        } catch {
            node.removeAttribute('style');
            continue;
        }
        walk(ast, {
            visit: 'Declaration',
            enter(decl: Declaration, item: ListItem<CssNode>, list: List<CssNode>) {
                const property = decl.property.toLowerCase();
                if (allowed.has(property) || !list) return;
                dropped.add(property);
                list.remove(item);
            },
        });
        const kept = generate(ast);
        if (kept) node.setAttribute('style', kept);
        else node.removeAttribute('style');
    }
    for (const property of dropped) pushError('css-property-dropped', { property });
}
