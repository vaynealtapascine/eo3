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

    it('groups a self-contained graph selection and remaps its links when copied', () => {
        const doc = new Document();
        const second = doc.addPart();
        const plugin = {
            id: 'x',
            acceptsInputs: true,
            acceptsNamedInputs: false,
        } as any;
        const source = new Module(plugin, {}) as AnyModule;
        const result = new Module(plugin, {}) as AnyModule;
        source.sends = [result.id];
        result.sends = [doc.parts[0].outputId];
        doc.insertModule(source);
        doc.insertModule(result);

        expect(doc.groupablePart([source.id, result.id])?.id).toBe(doc.parts[0].id);
        const group = doc.createGroup('Custom', doc.parts[0].id, [source.id, result.id])!;
        const copy = doc.duplicateGroup(group.id, second.id)!;
        expect(doc.findModule(copy.moduleIds[0])!.sends).toEqual([copy.moduleIds[1]]);
        expect(doc.findModule(copy.moduleIds[1])!.sends).toEqual([second.outputId]);
    });

    it('rejects a selection with incoming links from unselected modules', () => {
        const doc = new Document();
        const plugin = { id: 'x', acceptsInputs: true, acceptsNamedInputs: false } as any;
        const outside = new Module(plugin, {}) as AnyModule;
        const inside = new Module(plugin, {}) as AnyModule;
        outside.sends = [inside.id];
        inside.sends = [doc.parts[0].outputId];
        doc.insertModule(outside);
        doc.insertModule(inside);

        expect(doc.groupablePart([inside.id])).toBeNull();
        expect(doc.createGroup('Incomplete', doc.parts[0].id, [inside.id])).toBeNull();
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

describe('splitting a part', () => {
    async function oneChapter(contents: string) {
        const doc = new Document();
        const part = (await doc.addPartWithText('Chapter text'))!;
        doc.removePart(doc.parts[0].id);
        const text = doc.modules.find((m) => m.sends.includes(part.outputId))!;
        edit(doc, text.id, contents);
        doc.updatePart(part.id, { title: 'Arrival' });
        return { doc, part, text };
    }

    it('moves the second piece into a new part after it, sharing its styles', async () => {
        const { doc, part, text } = await oneChapter('<p>one</p><p>two</p>');
        const styles = (await doc.partStyles(part.id, 'Chapter styles'))!;
        const added = doc.splitPart(part.id, '<p>one</p>', '<p>two</p>')!;

        expect(doc.parts.map((p) => p.title)).toEqual(['Arrival', 'Arrival (continued)']);
        expect(contentsOf(doc, text.id)).toBe('<p>one</p>');
        const continued = doc.modules.find(
            (m) => m.sends.includes(added.outputId) && m.id !== styles
        )!;
        expect(contentsOf(doc, continued.id)).toBe('<p>two</p>');
        expect(doc.findModule(styles)!.sends).toEqual([part.outputId, added.outputId]);

        doc.undo();
        expect(doc.parts).toHaveLength(1);
        expect(contentsOf(doc, text.id)).toBe('<p>one</p><p>two</p>');
    });

    it('refuses a part whose content comes from several modules', async () => {
        const { doc, part } = await oneChapter('<p>one</p>');
        await doc.addPackagedEffect('letter', part.id);
        expect(doc.splittableContent(part.id)).toHaveProperty('reason');
        expect(doc.splitPart(part.id, 'a', 'b')).toBeNull();
    });
});
