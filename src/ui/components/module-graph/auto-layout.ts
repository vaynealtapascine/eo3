import { Document, ModuleId, AnyModule } from '../../../document';
import {
    MOD_HEADER_HEIGHT,
    MOD_INPUT_HEIGHT,
    MOD_OUTPUT_HEIGHT,
    MOD_NAMED_INPUT_HEIGHT,
    MIN_ROW_GAP,
    GRID_SIZE,
} from './consts';
import { GroupCard, groupCardHeight } from './group-cards';

export function collapsedStyles(doc: Document): Set<ModuleId> {
    return new Set(
        doc.parts.flatMap((part) => {
            const id = part.stylesModuleId;
            const mod = id && doc.findModule(id);
            if (!mod || mod.sends.length !== 1 || mod.sends[0] !== part.outputId) return [];
            const incoming = doc.findModuleInputIds(id);
            if (mod.namedSends.size || incoming.inputs.length || incoming.namedInputs.size)
                return [];
            return [id];
        })
    );
}

/** Something auto layout places: a module, a collapsed group card, or a part's output. */
interface LayoutItem {
    id: string;
    targets: string[];
    order: number;
    height: number;
    acceptsInputs: boolean;
    namedInputs: Set<string>;
    /** The expanded group this module belongs to, kept together under a frame header. */
    group?: string;
}

/** Items ordered so everything an item sends to comes before it. */
function toposort(items: Map<string, LayoutItem>): LayoutItem[] {
    const unmarked = new Set(items.values());
    const tmpMarked = new Set<LayoutItem>();
    const sorted: LayoutItem[] = [];

    const visit = (item: LayoutItem | undefined) => {
        if (!item || !unmarked.has(item) || tmpMarked.has(item)) return;
        tmpMarked.add(item);
        for (const target of item.targets) visit(items.get(target));
        tmpMarked.delete(item);
        unmarked.delete(item);
        sorted.unshift(item);
    };
    while (unmarked.size) visit([...unmarked][0]);
    return sorted.reverse();
}

export type NodeLayout = {
    column: number;
    index: number;
    y: number;
    height: number;
    acceptsInputs: boolean;
    namedInputs: Set<string>;
};
/** A laid-out node: a module (ordered by module index) or a part's output (listed first, in part order). */
type ColumnEntry = { id: string; order: number; group?: string };

export type GraphLayout = {
    columns: ColumnEntry[][];
    layouts: Map<string, NodeLayout>;
    indices: Map<ModuleId, number>;
};

/** Room above an expanded group's first member for its frame header. */
export const GROUP_HEADER_HEIGHT = GRID_SIZE;

/**
 * Lays out the graph in columns by distance from the outputs. A collapsed group is placed as
 * its one card; an expanded group's members stay next to each other in their columns.
 */
export function layoutNodes(
    doc: Document,
    groups: { cards: GroupCard[]; collapsedInto: Map<ModuleId, string> } = {
        cards: [],
        collapsedInto: new Map(),
    }
): GraphLayout {
    const hidden = collapsedStyles(doc);
    const { collapsedInto } = groups;
    const columns: ColumnEntry[][] = [];
    const nodeLayouts = new Map<string, NodeLayout>();
    const indices = new Map<ModuleId, number>();
    const items = new Map<string, LayoutItem>();

    const groupOrder = new Map<ModuleId, { order: number; group?: string }>();
    for (const card of groups.cards) {
        const first = Math.min(
            ...card.members.map((id) => doc.modules.findIndex((m) => m.id === id))
        );
        card.members.forEach((id, i) =>
            groupOrder.set(id, {
                order: first + i / card.members.length,
                group: card.expanded ? card.nodeId : undefined,
            })
        );
    }
    const targetsOf = (ids: ModuleId[], self: string) => {
        const targets = new Set<string>();
        for (const mod of ids.map((id) => doc.findModule(id)!)) {
            for (const target of [...mod.sends, ...mod.namedSends.keys()]) {
                if (hidden.has(target)) continue;
                const mapped = collapsedInto.get(target) ?? target;
                if (mapped !== self) targets.add(mapped);
            }
        }
        return [...targets];
    };

    doc.modules.forEach((mod, i) => {
        if (hidden.has(mod.id)) return;
        indices.set(mod.id, i);
        if (collapsedInto.has(mod.id)) return;
        items.set(mod.id, {
            id: mod.id,
            targets: targetsOf([mod.id], mod.id),
            order: groupOrder.get(mod.id)?.order ?? i,
            group: groupOrder.get(mod.id)?.group,
            height: getNodeHeight(doc, mod),
            acceptsInputs: mod.plugin.acceptsInputs,
            namedInputs: new Set(doc.findModuleInputIds(mod.id).namedInputs.keys()),
        });
    });
    for (const card of groups.cards) {
        if (card.expanded) continue;
        items.set(card.nodeId, {
            id: card.nodeId,
            targets: targetsOf(card.members, card.nodeId),
            order: groupOrder.get(card.members[0])!.order,
            height: groupCardHeight(card),
            acceptsInputs: card.inputs.length > 0,
            namedInputs: new Set(),
        });
    }

    columns.push([]);
    doc.parts.forEach((part, i) => {
        nodeLayouts.set(part.outputId, {
            column: 0,
            index: i,
            y: 0,
            // Room for the mascot, part label, and managed styles control.
            height: doc.parts.length > 1 ? 190 : 165,
            acceptsInputs: true,
            namedInputs: new Set(),
        });
        columns[0].push({ id: part.outputId, order: i - doc.parts.length });
    });

    for (const item of toposort(items)) {
        let column = 0;
        for (const target of item.targets) {
            const otherLoc = nodeLayouts.get(target);
            if (otherLoc) column = Math.max(column, otherLoc.column + 1);
        }

        while (!columns[column]) columns.push([]);
        nodeLayouts.set(item.id, {
            column,
            index: columns[column].length,
            y: 0,
            height: item.height,
            acceptsInputs: item.acceptsInputs,
            namedInputs: item.namedInputs,
        });
        columns[column].push({ id: item.id, order: item.order, group: item.group });
    }

    let colIndex = 0;
    for (const col of columns) {
        col.sort((a, b) => a.order - b.order);
        let y = 0;
        for (let i = 0; i < col.length; i++) {
            const layout = nodeLayouts.get(col[i].id)!;
            if (col[i].group && col[i].group !== col[i - 1]?.group) y += GROUP_HEADER_HEIGHT;
            layout.column = columns.length - 1 - colIndex;
            layout.index = i;
            layout.y = y;
            y += layout.height;
            y += MIN_ROW_GAP;
            y = Math.ceil(y / GRID_SIZE) * GRID_SIZE;
        }
        colIndex++;
    }

    return {
        columns: columns.reverse(),
        layouts: nodeLayouts,
        indices,
    };
}

export function getNodeHeight(doc: Document, mod: AnyModule) {
    let height = MOD_HEADER_HEIGHT;
    if (mod.plugin.acceptsInputs) height += MOD_INPUT_HEIGHT;
    height += MOD_OUTPUT_HEIGHT;
    const { namedInputs } = doc.findModuleInputIds(mod.id);
    for (let i = 0; i < namedInputs.size; i++) {
        height += MOD_NAMED_INPUT_HEIGHT;
    }
    if (mod.plugin.acceptsNamedInputs) height += MOD_NAMED_INPUT_HEIGHT;
    return height;
}
