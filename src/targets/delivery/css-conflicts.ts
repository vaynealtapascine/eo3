import { CssNode, generate, parse, walk } from 'css-tree';
import { CssSourceOutput } from '../../document';
import { PushError } from '../types';

/** Warn when the same selector has different rules in CSS with different part reach. */
export function scanCrossPartConflicts(
    sources: CssSourceOutput[],
    partIds: string[],
    pushError: PushError
): void {
    const seen = new Map<string, { body: string; partIds: string[] }[]>();
    const warned = new Set<string>();
    for (const source of sources) {
        if (source.partIds.length === partIds.length || !source.css.trim()) continue;
        let ast;
        try {
            ast = parse(source.css);
        } catch {
            continue; // The target's CSS validator reports invalid authored CSS.
        }
        walk(ast, {
            visit: 'Rule',
            enter: (node: CssNode) => {
                if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;
                const body = generate(node.block);
                node.prelude.children.forEach((selector) => {
                    const name = generate(selector);
                    const previous = seen.get(name) ?? [];
                    if (
                        !warned.has(name) &&
                        previous.some(
                            (entry) =>
                                entry.body !== body && !sameParts(entry.partIds, source.partIds)
                        )
                    ) {
                        const involved = new Set([
                            ...source.partIds,
                            ...previous.flatMap((entry) => entry.partIds),
                        ]);
                        pushError('cross-part-css-conflict', {
                            selector: name,
                            parts: partIds
                                .map((id, index) => (involved.has(id) ? index + 1 : null))
                                .filter((index) => index !== null),
                        });
                        warned.add(name);
                    }
                    previous.push({ body, partIds: source.partIds });
                    seen.set(name, previous);
                });
            },
        });
    }
}

function sameParts(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id) => b.includes(id));
}
