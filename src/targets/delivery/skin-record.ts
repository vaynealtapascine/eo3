import { parse } from 'css-tree';

function rules(css: string): { selector: string; text: string }[] {
    if (!css.trim()) return [];
    try {
        const sheet = parse(css, {
            parseRulePrelude: false,
            parseAtrulePrelude: false,
            parseValue: false,
            positions: true,
        });
        if (sheet.type !== 'StyleSheet') return [];
        const result: { selector: string; text: string }[] = [];
        sheet.children.forEach((node) => {
            if (node.type !== 'Rule' || node.prelude.type !== 'Raw' || !node.loc) return;
            result.push({
                selector: node.prelude.value.trim(),
                text: css.slice(node.loc.start.offset, node.loc.end.offset).trim(),
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
        const match = /^#workskin \.(eo3-(?!part-)[a-z0-9]+(?:-[a-z0-9]+)?)$/.exec(rule.selector);
        if (match) result[match[1]] = rule.text;
    }
    return result;
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
