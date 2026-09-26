import { describe, expect, it, vi } from 'vitest';
import { Document } from '../../src/document';
import {
    connectionId,
    groupCardHeight,
    groupCards,
    routeEdge,
    translateGroupMembers,
} from '../../src/ui/components/module-graph/group-cards';
import { GROUP_HEADER_HEIGHT, layoutNodes } from '../../src/ui/components/module-graph/auto-layout';

// The real Text plugin pulls in editors that need a full browser; the document only needs its id.
vi.mock('../../src/plugins', () => ({
    MODULES: {
        'source.text': {
            load: async () => ({
                id: 'source.text',
                acceptsInputs: false,
                acceptsNamedInputs: false,
                component: () => null,
                initialData: () => ({ contents: '', language: 'text' }),
                description: () => 'Text',
                eval: async () => null,
            }),
        },
    },
}));

const edge = (source: string, target: string, name?: string) => ({
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: 'out',
    targetHandle: name ? `named-in-${name}` : 'in',
    ...(name ? { data: { name } } : {}),
});

function send(doc: Document, from: string, to: string, name?: string) {
    const module = doc.findModule(from)!.shallowClone();
    if (name) {
        module.namedSends = new Map(module.namedSends);
        module.namedSends.set(to, new Set([name]));
    } else {
        module.sends = [...module.sends, to];
    }
    doc.insertModule(module);
}

describe('group cards in the graph', () => {
    it('collapses a group into one card unless it is expanded', async () => {
        const doc = new Document();
        const instance = (await doc.addPackagedEffect('letter', doc.parts[0].id))!;

        const collapsed = groupCards(doc, new Set(), []);
        expect(collapsed.cards).toEqual([
            expect.objectContaining({ title: 'Letter', members: instance.moduleIds }),
        ]);
        const nodeId = collapsed.cards[0].nodeId;
        expect([...collapsed.collapsedInto.values()]).toEqual([nodeId, nodeId]);

        const expanded = groupCards(doc, new Set(), [instance.id]);
        expect(expanded.cards[0].expanded).toBe(true);
        expect(expanded.collapsedInto.size).toBe(0);
    });

    it('lists the links that cross the group edge as its inputs and outputs', async () => {
        const doc = new Document();
        const letter = (await doc.addPackagedEffect('letter', doc.parts[0].id))!;
        const other = (await doc.addPackagedEffect('chat-log', doc.parts[0].id))!;
        const [html, styles] = letter.moduleIds;
        send(doc, other.moduleIds[0], html);
        send(doc, other.moduleIds[1], styles, 'accent');

        const card = groupCards(doc, new Set(), []).cards.find((c) => c.title === 'Letter')!;
        expect(card.inputs).toEqual([
            { handle: `in:${html}`, memberId: html, label: 'HTML' },
            { handle: `named:${styles}:accent`, memberId: styles, label: 'styles: accent' },
        ]);
        expect(card.outputs.map((port) => port.label)).toEqual(['HTML', 'styles']);
        expect(groupCardHeight(card)).toBe(24 + 2 * 20 + 2 * 20);
    });

    it('lays out a collapsed group as its card and keeps expanded members together', async () => {
        const doc = new Document();
        const letter = (await doc.addPackagedEffect('letter', doc.parts[0].id))!;
        const collapsed = groupCards(doc, new Set(), []);
        const card = collapsed.cards[0];
        const layout = layoutNodes(doc, collapsed);
        expect(layout.layouts.get(card.nodeId)).toMatchObject({ column: 0, y: 0 });
        for (const id of letter.moduleIds) expect(layout.layouts.has(id)).toBe(false);

        const expanded = layoutNodes(doc, groupCards(doc, new Set(), [letter.id]));
        const [first, second] = letter.moduleIds.map((id) => expanded.layouts.get(id)!);
        expect(first.y).toBe(GROUP_HEADER_HEIGHT);
        expect(second.index).toBe(first.index + 1);
    });

    it('leaves out hidden members and groups with fewer than two left', async () => {
        const doc = new Document();
        const instance = (await doc.addPackagedEffect('letter', doc.parts[0].id))!;
        expect(groupCards(doc, new Set([instance.moduleIds[1]]), []).cards).toEqual([]);
    });

    it('routes edges to the card, drops internal ones, and keeps the connection id', () => {
        const into = new Map([
            ['a', 'group:g'],
            ['b', 'group:g'],
        ]);
        expect(routeEdge(edge('a', 'b'), into)).toBeNull();
        expect(routeEdge(edge('x', 'y'), into)).toEqual(edge('x', 'y'));

        const out = routeEdge(edge('b', 'output'), into)!;
        expect(out).toMatchObject({ source: 'group:g', sourceHandle: 'out:b', target: 'output' });
        expect(connectionId(out.id)).toBe('b->output');

        const named = routeEdge(edge('x', 'b', 'accent'), into)!;
        expect(named).toMatchObject({ target: 'group:g', targetHandle: 'named:b:accent' });

        const incoming = routeEdge(edge('x', 'a'), into)!;
        expect(incoming).toMatchObject({ source: 'x', target: 'group:g', targetHandle: 'in:a' });
        expect(connectionId(incoming.id)).toBe('x->a');
        // A fresh id, so the expanded member edge is a new edge to React Flow.
        expect(incoming.id).not.toBe('x->a');
    });

    it('moves every member by one drag offset without changing another group', async () => {
        const doc = new Document();
        const first = (await doc.addPackagedEffect('letter', doc.parts[0].id))!;
        const other = (await doc.addPackagedEffect('letter', doc.parts[0].id))!;
        const positions = new Map([
            [first.moduleIds[0], { x: 10, y: 20 }],
            [first.moduleIds[1], { x: 30, y: 40 }],
        ]);
        const moved = translateGroupMembers(doc.modules, first.moduleIds, positions, {
            x: 100,
            y: -10,
        });

        expect(moved.find((mod) => mod.id === first.moduleIds[0])!.graphPos).toEqual({
            x: 110,
            y: 10,
        });
        expect(moved.find((mod) => mod.id === first.moduleIds[1])!.graphPos).toEqual({
            x: 130,
            y: 30,
        });
        expect(moved.find((mod) => mod.id === other.moduleIds[0])).toBe(
            doc.findModule(other.moduleIds[0])
        );
        expect(doc.findModule(first.moduleIds[0])!.graphPos).toBeNull();
    });
});
