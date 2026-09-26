import { fnv1a36 as hashString } from '../../../util/hash';

/**
 * Canonical declarations of a `style` value: property names lowercased, whitespace collapsed, a
 * repeated property keeping its last value (as the browser and AO3's css_parser do). Sorted,
 * unless a shorthand and one of its longhands both appear (`background` + `background-color`):
 * then the written order decides the result, so it is kept. Equivalent blocks share one class;
 * blocks that render differently never do.
 *
 * The class name is `eo3-` + hashString(these joined by `;`). Posted chapters depend on that
 * mapping, so changing it renames every lifted class; see test/ao3/lift-styles.test.ts.
 */
function canonicalDecls(style: string): string[] {
    const byProperty = new Map<string, string>();
    const bare: string[] = [];
    for (const decl of style.split(';')) {
        const colon = decl.indexOf(':');
        if (colon === -1) {
            const text = decl.trim().replace(/\s+/g, ' ');
            if (text) bare.push(text);
            continue;
        }
        const prop = decl.slice(0, colon).trim().toLowerCase();
        const value = decl
            .slice(colon + 1)
            .trim()
            .replace(/\s+/g, ' ');
        if (!prop || !value) continue;
        byProperty.delete(prop); // re-insert so the last value wins
        byProperty.set(prop, value);
    }
    const props = [...byProperty.keys()];
    const decls = [...bare, ...[...byProperty].map(([prop, value]) => `${prop}:${value}`)];
    const orderMatters = props.some((a) => props.some((b) => b.startsWith(a + '-')));
    return orderMatters ? decls : decls.sort();
}

export interface ClassCollision {
    kind: 'class-collision';
    className: string;
    /** The two different style blocks that hashed to `className`. */
    styles: [string, string];
}

/**
 * AO3 strips inline `style` but allows `class`, so before sanitizing, each distinct style block
 * becomes a content-hashed `eo3-<hash>` class on the element and a rule in the returned CSS,
 * sorted by class name so the output doesn't depend on document order. Two different blocks with
 * the same hash are reported; the later one gets a longer, still deterministic name.
 */
export function liftInlineStyles(
    root: Element,
    onCollision?: (collision: ClassCollision) => void
): string {
    const classByDecls = new Map<string, string>();
    const declsByClass = new Map<string, string>();
    const rules = new Map<string, string>();

    for (const node of Array.from(root.querySelectorAll('[style]'))) {
        const style = node.getAttribute('style') || '';
        node.removeAttribute('style');
        const decls = canonicalDecls(style);
        if (!decls.length) continue;
        const key = decls.join(';');

        let className = classByDecls.get(key);
        if (!className) {
            className = `eo3-${hashString(key)}`;
            const other = declsByClass.get(className);
            if (other !== undefined) {
                onCollision?.({ kind: 'class-collision', className, styles: [other, key] });
                className = `${className}-${hashString('\0' + key)}`;
            }
            classByDecls.set(key, className);
            declsByClass.set(className, key);
            const body = decls.map((d) => d.replace(':', ': ')).join('; ');
            rules.set(className, `.${className} { ${body} }`);
        }
        node.classList.add(className);
    }

    return [...rules.keys()]
        .sort()
        .map((c) => rules.get(c))
        .join('\n');
}
