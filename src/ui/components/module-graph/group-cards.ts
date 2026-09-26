import { AnyModule, Document, ModuleId } from '../../../document';

const GROUP_NODE_PREFIX = 'group:';
export const isGroupNode = (id: string) => id.startsWith(GROUP_NODE_PREFIX);

/** Edges drawn to a collapsed group get their own ids, so React Flow redraws them on expand. */
const VIA_GROUP = ' via ';
/** The connection an edge id stands for, whether or not it was rerouted to a group card. */
export const connectionId = (edgeId: string) => edgeId.split(VIA_GROUP)[0];

export interface GroupCard {
    instanceId: string;
    nodeId: string;
    title: string;
    /** Visible members, in the instance's order. */
    members: ModuleId[];
    expanded: boolean;
}

/** Group instances as graph cards; members of collapsed ones map to their card's node. */
export function groupCards(doc: Document, hidden: Set<ModuleId>, expanded: readonly string[]) {
    const collapsedInto = new Map<ModuleId, string>();
    const cards: GroupCard[] = doc.groupInstances.flatMap((instance) => {
        const members = instance.moduleIds.filter((id) => doc.findModule(id) && !hidden.has(id));
        if (members.length < 2) return [];
        const card = {
            instanceId: instance.id,
            nodeId: GROUP_NODE_PREFIX + instance.id,
            title:
                doc.groupDefinitions.find((d) => d.id === instance.definitionId)?.title ?? 'Group',
            members,
            expanded: expanded.includes(instance.id),
        };
        if (!card.expanded) for (const id of members) collapsedInto.set(id, card.nodeId);
        return [card];
    });
    return { cards, collapsedInto };
}

/** Commit a dragged card by giving every member the same offset from its visible position. */
export function translateGroupMembers(
    modules: readonly AnyModule[],
    members: readonly ModuleId[],
    positions: ReadonlyMap<ModuleId, { x: number; y: number }>,
    delta: { x: number; y: number }
): AnyModule[] {
    const memberIds = new Set(members);
    return modules.map((module) => {
        const position = memberIds.has(module.id) ? positions.get(module.id) : null;
        if (!position) return module;
        const moved = module.shallowClone();
        moved.graphPos = { x: position.x + delta.x, y: position.y + delta.y };
        return moved;
    });
}

interface Edge {
    id: string;
    source: string;
    target: string;
    targetHandle: string;
}

/** Points an edge at the cards that hide its ends; null when it lies inside one card. */
export function routeEdge<E extends Edge>(edge: E, collapsedInto: Map<ModuleId, string>): E | null {
    const source = collapsedInto.get(edge.source) ?? edge.source;
    const target = collapsedInto.get(edge.target);
    if (target === source) return null;
    if (target === undefined) {
        if (source === edge.source) return edge;
        return { ...edge, id: edge.id + VIA_GROUP + source, source };
    }
    return { ...edge, id: edge.id + VIA_GROUP + target, source, target, targetHandle: 'in' };
}
