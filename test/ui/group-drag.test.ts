import { describe, expect, it, vi } from 'vitest';
import { Document } from '../../src/document';
import { ModuleGraph } from '../../src/ui/components/module-graph';
import { addExample } from '../helpers/examples';

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

describe('dragging a collapsed group card', () => {
    it('tracks the controlled card position and commits one undoable move', async () => {
        const document = new Document();
        const instance = await addExample(document, 'Letter');
        const graph = new ModuleGraph({
            document,
            selected: null,
            render: {} as any,
            onSelect: vi.fn(),
        });
        graph.setState = ((changes: object) => {
            graph.state = { ...graph.state, ...changes };
        }) as any;
        graph.modulePositions = new Map([
            [instance.moduleIds[0], { x: 10, y: 20 }],
            [instance.moduleIds[1], { x: 30, y: 40 }],
        ]);

        const nodeId = `group:${instance.id}`;
        graph.onNodeDragStart({ id: nodeId, position: { x: 30, y: 40 } });
        graph.onNodesChange([
            { id: nodeId, type: 'position', position: { x: 130, y: 60 }, dragging: true },
        ]);
        expect(graph.state.groupDragPosition?.position).toEqual({ x: 130, y: 60 });
        graph.onNodeDragStop({ id: nodeId, position: { x: 130, y: 60 } });

        expect(document.findModule(instance.moduleIds[0])!.graphPos).toEqual({ x: 110, y: 40 });
        expect(document.findModule(instance.moduleIds[1])!.graphPos).toEqual({ x: 130, y: 60 });
        expect(graph.state.groupDragPosition).toBeNull();
        document.undo();
        expect(document.findModule(instance.moduleIds[0])!.graphPos).toBeNull();
    });
});
