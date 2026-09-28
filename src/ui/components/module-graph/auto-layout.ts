import { Document, ModuleId, AnyModule, isCssModule } from '../../../document';
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
export const GROUP_FRAME_PADDING = 8;

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
            // Keep the HTML path above its stylesheet at a chapter output.
            order: groupOrder.get(mod.id)?.order ?? (isCssModule(mod) ? i + doc.modules.length : i),
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
            // Room for the HTML and CSS inputs, the mascot and the part label.
            height: doc.parts.length > 1 ? 196 : 172,
            acceptsInputs: true,
            namedInputs: new Set(),
        });
        columns[0].push({ id: part.outputId, order: i - doc.parts.length });
    });

    const expandedByMember = new Map(
        groups.cards
            .filter((card) => card.expanded)
            .flatMap((card) => card.members.map((id) => [id, card] as const))
    );
    const depths = new Map<string, number>();
    const visiting = new Set<string>();
    const depthOf = (id: string): number => {
        if (depths.has(id)) return depths.get(id)!;
        const item = items.get(id);
        if (!item || visiting.has(id)) return 0;
        visiting.add(id);
        let depth = 0;
        for (const target of item.targets) {
            const group = expandedByMember.get(target);
            // An external input belongs to the left of the entire expanded frame,
            // rather than sharing a column with its internal helper components.
            const targetDepth =
                group && item.group !== group.nodeId
                    ? Math.max(...group.members.map(depthOf))
                    : depthOf(target);
            depth = Math.max(depth, targetDepth + 1);
        }
        visiting.delete(id);
        depths.set(id, depth);
        return depth;
    };

    for (const item of toposort(items)) {
        const column = depthOf(item.id);

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

    // Reserve an expanded group's whole rectangle in every column it spans.
    // This keeps unrelated styles and inputs out of its frame, including its header.
    const blocks = new Map<string, { order: number; members: ColumnEntry[]; expanded: boolean }>();
    columns.forEach((column) =>
        column.forEach((entry) => {
            const key = entry.group ?? entry.id;
            const block = blocks.get(key) ?? {
                order: entry.order,
                members: [],
                expanded: !!entry.group,
            };
            block.order = Math.min(block.order, entry.order);
            block.members.push(entry);
            blocks.set(key, block);
        })
    );
    const cursors = columns.map(() => 0);
    const snap = (y: number) => Math.ceil(y / GRID_SIZE) * GRID_SIZE;
    for (const block of [...blocks.values()].sort((a, b) => a.order - b.order)) {
        const occupied = block.members.map((entry) => nodeLayouts.get(entry.id)!.column);
        const left = Math.min(...occupied),
            right = Math.max(...occupied);
        const top = Math.max(...cursors.slice(left, right + 1));
        const rows = new Map<number, number>();
        let bottom = top;
        for (const entry of block.members.sort((a, b) => a.order - b.order)) {
            const layout = nodeLayouts.get(entry.id)!;
            layout.y = rows.get(layout.column) ?? top + (block.expanded ? GROUP_HEADER_HEIGHT : 0);
            bottom = Math.max(bottom, layout.y + layout.height);
            rows.set(layout.column, snap(layout.y + layout.height + MIN_ROW_GAP));
        }
        const next = snap(bottom + MIN_ROW_GAP + (block.expanded ? GROUP_FRAME_PADDING : 0));
        for (let column = left; column <= right; column++) cursors[column] = next;
    }
    columns.forEach((column, colIndex) => {
        column.sort((a, b) => nodeLayouts.get(a.id)!.y - nodeLayouts.get(b.id)!.y);
        column.forEach((entry, i) => {
            const layout = nodeLayouts.get(entry.id)!;
            layout.column = columns.length - 1 - colIndex;
            layout.index = i;
        });
    });

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
