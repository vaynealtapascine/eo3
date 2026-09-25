/** FNV-1a 32-bit → base36: cheap, synchronous, and deterministic across renders and sessions. */
function hashString(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

/** Canonical form of a `style` value so equivalent blocks (order, whitespace) dedup to one class. */
function normalizeDecls(style: string): string {
    return style
        .split(';')
        .map((decl) => {
            const colon = decl.indexOf(':');
            if (colon === -1) return decl.trim().replace(/\s+/g, ' ');
            const prop = decl.slice(0, colon).trim().toLowerCase();
            const value = decl
                .slice(colon + 1)
                .trim()
                .replace(/\s+/g, ' ');
            return prop && value ? `${prop}:${value}` : '';
        })
        .filter(Boolean)
        .sort()
        .join(';');
}

/**
 * AO3 strips inline `style` but allows `class`, so before sanitizing, each distinct style block
 * becomes a content-hashed `eo3-<hash>` class on the element and a rule in the returned CSS.
 * The hash is deterministic so a chapter posted earlier keeps matching a workskin regenerated
 * later. Returns the generated rules, newline-joined.
 */
export function liftInlineStyles(root: Element): string {
    const classByDecls = new Map<string, string>();
    const rules: string[] = [];

    for (const node of Array.from(root.querySelectorAll('[style]'))) {
        const style = node.getAttribute('style') || '';
        node.removeAttribute('style');
        const normalized = normalizeDecls(style);
        if (!normalized) continue;

        let className = classByDecls.get(normalized);
        if (!className) {
            className = `eo3-${hashString(normalized)}`;
            classByDecls.set(normalized, className);
            const original = style
                .split(';')
                .map((d) => d.trim())
                .filter(Boolean)
                .join('; ');
            rules.push(`.${className} { ${original} }`);
        }
        node.classList.add(className);
    }

    return rules.join('\n');
}
