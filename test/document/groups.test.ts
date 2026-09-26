import { describe, expect, it, vi } from 'vitest';
import { AnyModule, Document, Module } from '../../src/document';
import { serializeV1, deserializeV1 } from '../../src/storage/versions/v1';

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

function edit(doc: Document, id: string, contents: string) {
    const module = doc.findModule(id)!.shallowClone();
    module.data = { ...(module.data as object), contents };
    doc.insertModule(module);
}

const contentsOf = (doc: Document, id: string) =>
    (doc.findModule(id)!.data as { contents: string }).contents;

describe('packaged effects', () => {
    it('adds an effect as HTML and CSS modules wired to the part, in one undo step', async () => {
        const doc = new Document();
        const part = doc.parts[0];
        const instance = (await doc.addPackagedEffect('letter', part.id))!;
        expect(instance.moduleIds).toHaveLength(2);
        for (const id of instance.moduleIds) {
            expect(doc.findModule(id)!.sends).toEqual([part.outputId]);
        }
        expect(contentsOf(doc, instance.moduleIds[0])).toContain('class="fx-letter"');
        expect(doc.groupDefinitions.map((d) => d.shelfKey)).toEqual(['letter']);

        doc.undo();
        expect(doc.modules).toHaveLength(0);
        expect(doc.groupInstances).toHaveLength(0);
    });

    it('never uses the eo3- class prefix, which is reserved for generated classes', async () => {
        const { EFFECTS } = await import('../../src/effects');
        for (const effect of Object.values(EFFECTS)) {
            expect(effect.html + effect.css).not.toMatch(/\beo3-/);
        }
    });
});

describe('shared groups', () => {
    async function sharedLetter() {
        const doc = new Document();
        const second = doc.addPart('Chapter 2');
        const a = (await doc.addPackagedEffect('letter', doc.parts[0].id))!;
        const b = (await doc.addPackagedEffect('letter', second.id))!;
        return { doc, second, a, b };
    }

    it('reuses the definition for a second part, wired to that part', async () => {
        const { doc, second, a, b } = await sharedLetter();
        expect(b.definitionId).toBe(a.definitionId);
        expect(doc.groupDefinitions).toHaveLength(1);
        expect(doc.findModule(b.moduleIds[0])!.sends).toEqual([second.outputId]);
    });

    it('shares edits between instances until one is detached', async () => {
        const { doc, a, b } = await sharedLetter();
        edit(doc, a.moduleIds[0], '<p>Shared</p>');
        expect(contentsOf(doc, b.moduleIds[0])).toBe('<p>Shared</p>');

        doc.detachGroup(b.id);
        edit(doc, a.moduleIds[0], '<p>Only A</p>');
        expect(contentsOf(doc, b.moduleIds[0])).toBe('<p>Shared</p>');
        expect(doc.groupDefinitions).toHaveLength(2);
    });

    it('forgets instances whose part or module is removed', async () => {
        const { doc, second, a, b } = await sharedLetter();
        doc.removePart(second.id);
        expect(doc.groupInstances.map((i) => i.id)).toEqual([a.id]);
        expect(doc.findModule(b.moduleIds[0])).toBeDefined(); // only unwired, not deleted

        doc.removeModule(a.moduleIds[1]);
        expect(doc.groupInstances).toHaveLength(0);
    });

    it('only groups modules that stay inside the group and its part', () => {
        const doc = new Document();
        const second = doc.addPart();
        const inside = new Module(
            { id: 'x', acceptsInputs: false, acceptsNamedInputs: false } as any,
            {}
        ) as unknown as AnyModule;
        inside.sends = [doc.parts[0].outputId, second.outputId];
        doc.insertModule(inside);
        expect(doc.createGroup('Mixed', doc.parts[0].id, [inside.id])).toBeNull();
    });
});

describe('saving and loading groups', () => {
    it.each(['toml', 'json'])('round-trips definitions and instances (%s)', async (format) => {
        const doc = new Document();
        const second = doc.addPart('Chapter 2');
        await doc.addPackagedEffect('chat-log', doc.parts[0].id);
        await doc.addPackagedEffect('chat-log', second.id);

        const loaded = deserializeV1(serializeV1(doc, format));
        expect(loaded.groupDefinitions).toEqual(doc.groupDefinitions);
        expect(loaded.groupInstances.map((i) => [i.id, i.definitionId, i.partId])).toEqual(
            doc.groupInstances.map((i) => [i.id, i.definitionId, i.partId])
        );
        const [first] = loaded.groupInstances;
        expect(loaded.findModule(first.moduleIds[0])!.title).toBe('Chat log HTML');
    });
});
