import { Document, ModuleId, AnyModule } from '../../../document';
import {
    MOD_HEADER_HEIGHT,
    MOD_INPUT_HEIGHT,
    MOD_OUTPUT_HEIGHT,
    MOD_NAMED_INPUT_HEIGHT,
    MIN_ROW_GAP,
    GRID_SIZE,
} from './consts';

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

function toposortDoc(
    doc: Document,
    hidden: Set<ModuleId>,
    backwards: boolean = false
): AnyModule[] {
    const indexedNodes = new Map();
    for (const node of doc.modules.filter((node) => !hidden.has(node.id)))
        indexedNodes.set(node.id, node);
    const unmarkedNodes = new Set(indexedNodes.values());
    const tmpMarkedNodes = new Set();
    const sorted: AnyModule[] = [];

    const visit = (node: AnyModule) => {
        if (!unmarkedNodes.has(node)) return;
        if (tmpMarkedNodes.has(node)) return;
        tmpMarkedNodes.add(node);
        for (const targetId of node.sends) {
            visit(indexedNodes.get(targetId));
        }
        for (const targetId of node.namedSends.keys()) {
            visit(indexedNodes.get(targetId));
        }
        tmpMarkedNodes.delete(node);
        unmarkedNodes.delete(node);
        sorted.unshift(node);
    };

    while (unmarkedNodes.size) {
        if (backwards) {
            visit([...unmarkedNodes][0]);
        } else {
            visit([...unmarkedNodes].pop()!);
        }
    }

    return backwards ? sorted.reverse() : sorted;
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
type ColumnEntry = { id: ModuleId; order: number };

export type GraphLayout = {
    columns: ColumnEntry[][];
    layouts: Map<ModuleId, NodeLayout>;
    indices: Map<ModuleId, number>;
};
export function layoutNodes(doc: Document): GraphLayout {
    const hidden = collapsedStyles(doc);
    const columns: ColumnEntry[][] = [];
    const nodeLayouts = new Map<ModuleId, NodeLayout>();

    const indices = new Map();
    const indexedNodes = new Map();
    const outgoingEdges = new Map();
    for (let i = 0; i < doc.modules.length; i++) {
        const node = doc.modules[i];
        if (hidden.has(node.id)) continue;
        indices.set(node.id, i);
        indexedNodes.set(node.id, node);
        const edges = new Set([...node.sends, ...node.namedSends.keys()]);
        outgoingEdges.set(node, edges);
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

    for (const node of toposortDoc(doc, hidden, true)) {
        let column = 0;
        for (const otherNodeId of outgoingEdges.get(node)) {
            const otherLoc = nodeLayouts.get(otherNodeId)!;
            if (otherLoc) {
                column = Math.max(column, otherLoc.column + 1);
            }
        }

        const { namedInputs } = doc.findModuleInputIds(node.id);

        while (!columns[column]) columns.push([]);
        const index = columns[column].length;
        nodeLayouts.set(node.id, {
            column,
            index,
            y: 0,
            height: getNodeHeight(doc, node),
            acceptsInputs: node.plugin.acceptsInputs,
            namedInputs: new Set(namedInputs.keys()),
        });
        columns[column].push({ id: node.id, order: indices.get(node.id) });
    }

    let colIndex = 0;
    for (const col of columns) {
        col.sort((a, b) => a.order - b.order);
        let y = 0;
        for (let i = 0; i < col.length; i++) {
            const layout = nodeLayouts.get(col[i].id)!;
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

function getNodeHeight(doc: Document, mod: AnyModule) {
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
