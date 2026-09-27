import { AnyModule, Document, ModuleId } from '../../../document';
import { MOD_HEADER_HEIGHT, MOD_INPUT_HEIGHT, MOD_OUTPUT_HEIGHT } from './consts';

const GROUP_NODE_PREFIX = 'group:';
export const isGroupNode = (id: string) => id.startsWith(GROUP_NODE_PREFIX);

/** Edges drawn to a collapsed group get their own ids, so React Flow redraws them on expand. */
const VIA_GROUP = ' via ';
/** The connection an edge id stands for, whether or not it was rerouted to a group card. */
export const connectionId = (edgeId: string) => edgeId.split(VIA_GROUP)[0];

/** A connection crossing a collapsed group's edge, drawn as one row of its card. */
export interface GroupPort {
    handle: string;
    memberId: ModuleId;
    label: string;
}

export interface GroupCard {
    groupId: string;
    nodeId: string;
    title: string;
    /** Visible members, in the instance's order. */
    members: ModuleId[];
    expanded: boolean;
    /** Members fed from outside the group. */
    inputs: GroupPort[];
    /** Members that send outside the group. */
    outputs: GroupPort[];
}

const outHandle = (member: ModuleId) => `out:${member}`;
const inHandle = (member: ModuleId) => `in:${member}`;
const namedHandle = (member: ModuleId, name: string) => `named:${member}:${name}`;

/** Groups as graph cards; members of collapsed ones map to their card's node. */
export function groupCards(doc: Document, hidden: Set<ModuleId>, expanded: readonly string[]) {
    const collapsedInto = new Map<ModuleId, string>();
    const cards: GroupCard[] = doc.groups.flatMap((group) => {
        const members = group.moduleIds.filter((id) => doc.findModule(id) && !hidden.has(id));
        if (members.length < 2) return [];
        const title = group.title;
        const card = {
            groupId: group.id,
            nodeId: GROUP_NODE_PREFIX + group.id,
            title,
            members,
            expanded: expanded.includes(group.id),
            ...groupPorts(doc, hidden, members, title),
        };
        if (!card.expanded) for (const id of members) collapsedInto.set(id, card.nodeId);
        return [card];
    });
    return { cards, collapsedInto };
}

function groupPorts(doc: Document, hidden: Set<ModuleId>, members: ModuleId[], title: string) {
    const outside = (id: ModuleId) => !members.includes(id) && !hidden.has(id);
    const inputs: GroupPort[] = [];
    const outputs: GroupPort[] = [];
    for (const memberId of members) {
        const module = doc.findModule(memberId)!;
        const label = memberLabel(module, title);
        const incoming = doc.findModuleInputIds(memberId);
        if (incoming.inputs.some(outside)) {
            inputs.push({ handle: inHandle(memberId), memberId, label });
        }
        for (const [name, source] of incoming.namedInputs) {
            if (outside(source)) {
                inputs.push({
                    handle: namedHandle(memberId, name),
                    memberId,
                    label: `${label}: ${name}`,
                });
            }
        }
        if ([...module.sends, ...module.namedSends.keys()].some(outside)) {
            outputs.push({ handle: outHandle(memberId), memberId, label });
        }
    }
    return { inputs, outputs };
}

/** A member's name without the group's, so "Letter styles" in "Letter" reads "styles". */
function memberLabel(module: AnyModule, groupTitle: string) {
    const name = module.title || module.plugin.description(module.data);
    const prefix = groupTitle.toLowerCase() + ' ';
    const short = name.toLowerCase().startsWith(prefix) ? name.slice(prefix.length) : name;
    return short.trim() || name;
}

/** Height of a collapsed card, matching its rendering in group-node.tsx. */
export function groupCardHeight(card: GroupCard) {
    return (
        MOD_HEADER_HEIGHT +
        card.inputs.length * MOD_INPUT_HEIGHT +
        Math.max(card.outputs.length, 1) * MOD_OUTPUT_HEIGHT
    );
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
    sourceHandle: string;
    targetHandle: string;
    data?: { name: string };
}

/**
 * Points an edge at the cards that hide its ends, on the row for the member it leaves or
 * enters; null when it lies inside one card.
 */
export function routeEdge<E extends Edge>(edge: E, collapsedInto: Map<ModuleId, string>): E | null {
    const source = collapsedInto.get(edge.source);
    const target = collapsedInto.get(edge.target);
    if (source === undefined && target === undefined) return edge;
    if (source !== undefined && source === target) return null;
    const routed = { ...edge, id: edge.id + VIA_GROUP + (target ?? source) };
    if (source !== undefined) {
        routed.source = source;
        routed.sourceHandle = outHandle(edge.source);
    }
    if (target !== undefined) {
        routed.target = target;
        routed.targetHandle = edge.data
            ? namedHandle(edge.target, edge.data.name)
            : inHandle(edge.target);
    }
    return routed;
}
