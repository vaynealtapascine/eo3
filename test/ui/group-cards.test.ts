import { describe, expect, it, vi } from 'vitest';
import { Document } from '../../src/document';
import {
    connectionId,
    groupCards,
    routeEdge,
    translateGroupMembers,
} from '../../src/ui/components/module-graph/group-cards';

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

const edge = (source: string, target: string) => ({
    id: `${source}->${target}`,
    source,
    target,
    targetHandle: 'named-in-x',
});

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
        expect(out).toMatchObject({ source: 'group:g', target: 'output' });
        expect(connectionId(out.id)).toBe('b->output');

        const incoming = routeEdge(edge('x', 'a'), into)!;
        expect(incoming).toMatchObject({ source: 'x', target: 'group:g', targetHandle: 'in' });
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
