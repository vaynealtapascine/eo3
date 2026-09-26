import { parse } from 'css-tree';

function rules(css: string): { selector: string; text: string; start: number; end: number }[] {
    if (!css.trim()) return [];
    try {
        const sheet = parse(css, {
            parseRulePrelude: false,
            parseAtrulePrelude: false,
            parseValue: false,
            positions: true,
        });
        if (sheet.type !== 'StyleSheet') return [];
        const result: { selector: string; text: string; start: number; end: number }[] = [];
        sheet.children.forEach((node) => {
            if (node.type !== 'Rule' || node.prelude.type !== 'Raw' || !node.loc) return;
            result.push({
                selector: node.prelude.value.trim(),
                text: css.slice(node.loc.start.offset, node.loc.end.offset).trim(),
                start: node.loc.start.offset,
                end: node.loc.end.offset,
            });
        });
        return result;
    } catch {
        return [];
    }
}

/** Lifted AO3 rules from its canonical Work Skin, keyed by their generated class. */
export function liftedSkinRules(css: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const rule of rules(css)) {
        const match = /^(?:#workskin )?\.(eo3-(?!part-)[a-z0-9]+(?:-[a-z0-9]+)?)$/.exec(
            rule.selector
        );
        if (match) result[match[1]] = rule.text;
    }
    return result;
}

/** Remove selected single-class generated rules from an imported Work Skin. */
export function removeLiftedSkinRules(css: string, names: string[]): string {
    const selected = new Set(names);
    const ranges = rules(css)
        .filter((rule) => {
            const match = /^(?:#workskin )?\.(eo3-(?!part-)[a-z0-9]+(?:-[a-z0-9]+)?)$/.exec(
                rule.selector
            );
            return !!match && selected.has(match[1]);
        })
        .sort((a, b) => a.start - b.start);
    let result = '';
    let offset = 0;
    for (const range of ranges) {
        result += css.slice(offset, range.start);
        offset = range.end;
    }
    return (result + css.slice(offset)).replace(/\n{3,}/g, '\n\n').trim();
}

/** A changed rule counts once as added and once as removed. */
export function diffSkinRules(before: string, after: string): { added: number; removed: number } {
    const oldRules = new Set(rules(before).map((rule) => rule.text));
    const newRules = new Set(rules(after).map((rule) => rule.text));
    return {
        added: [...newRules].filter((rule) => !oldRules.has(rule)).length,
        removed: [...oldRules].filter((rule) => !newRules.has(rule)).length,
    };
}
