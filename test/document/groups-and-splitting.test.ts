import { describe, expect, it, vi } from 'vitest';
import { AnyModule, Document, Module } from '../../src/document';
import { serializeV1, deserializeV1 } from '../../src/storage/versions/v1';
import { parseGroupFile, stringifyGroupFile } from '../../src/storage/group-file';
import { addExample } from '../helpers/examples';

// The real Text plugin pulls in editors that need a full browser; the document only needs its id.
vi.mock('../../src/plugins', () => ({
    MODULES: Object.fromEntries(
        ['source.text', 'source.svelte', 'source.svelte-component'].map((id) => [
            id,
            {
                load: async () => ({
                    id,
                    acceptsInputs: false,
                    acceptsNamedInputs: false,
                    component: () => null,
                    initialData: () => ({ contents: '', language: 'text' }),
                    description: () => 'Text',
                    eval: async () => null,
                }),
            },
        ])
    ),
}));

function edit(doc: Document, id: string, contents: string) {
    const module = doc.findModule(id)!.shallowClone();
    module.data = { ...(module.data as object), contents };
    doc.insertModule(module);
}

const contentsOf = (doc: Document, id: string) =>
    (doc.findModule(id)!.data as { contents: string }).contents;

const TEXT = { id: 'source.text', acceptsInputs: false, acceptsNamedInputs: false } as any;
const TRANSFORM = { id: 'source.text', acceptsInputs: true, acceptsNamedInputs: true } as any;

/** Text → transform → part output, with the transform fed from outside the two. */
function chain(doc: Document) {
    const outside = new Module(TEXT, { contents: 'in', language: 'html' }) as unknown as AnyModule;
    const source = new Module(TEXT, { contents: 'a', language: 'html' }) as unknown as AnyModule;
    const result = new Module(TRANSFORM, {
        contents: 'b',
        language: 'html',
    }) as unknown as AnyModule;
    outside.sends = [result.id];
    source.sends = [result.id];
    source.namedSends = new Map([[result.id, new Set(['side'])]]);
    result.sends = [doc.parts[0].outputId];
    for (const mod of [outside, source, result]) doc.insertModule(mod);
    return { outside, source, result };
}

describe('groups', () => {
    it('groups any selection, wired to anything, and keeps its layout', () => {
        const doc = new Document();
        const { source, result } = chain(doc);
        const positions = new Map([
            [source.id, { x: -300, y: 0 }],
            [result.id, { x: -150, y: 24 }],
        ]);
        const group = doc.createGroup('Pair', [source.id, result.id], positions)!;

        expect(group.moduleIds).toEqual([source.id, result.id]);
        expect(doc.findModule(result.id)!.graphPos).toEqual({ x: -150, y: 24 });
        doc.undo();
        expect(doc.groups).toHaveLength(0);
        expect(doc.findModule(result.id)!.graphPos).toBeNull();
    });

    it('refuses fewer than two modules or ones already grouped', () => {
        const doc = new Document();
        const { outside, source, result } = chain(doc);
        expect(doc.canGroup([source.id])).toBe(false);
        doc.createGroup('Pair', [source.id, result.id]);
        expect(doc.canGroup([outside.id, result.id])).toBe(false);
    });

    it('keeps modules wired as they were when ungrouped or renamed', () => {
        const doc = new Document();
        const { source, result } = chain(doc);
        const group = doc.createGroup('Pair', [source.id, result.id])!;
        doc.renameGroup(group.id, 'Renamed');
        expect(doc.findGroup(group.id)!.title).toBe('Renamed');
        doc.ungroup(group.id);
        expect(doc.groups).toHaveLength(0);
        expect(doc.findModule(source.id)!.sends).toEqual([result.id]);
    });

    it('drops a group once fewer than two of its modules are left', () => {
        const doc = new Document();
        const { source, result } = chain(doc);
        doc.createGroup('Pair', [source.id, result.id]);
        doc.removeModule(source.id);
        expect(doc.groups).toHaveLength(0);
    });

    it('exports only links inside the group, with positions relative to it', () => {
        const doc = new Document();
        const { source, result } = chain(doc);
        const positions = new Map([
            [source.id, { x: -300, y: 48 }],
            [result.id, { x: -150, y: 72 }],
        ]);
        const group = doc.createGroup('Pair', [source.id, result.id], positions)!;
        const file = doc.groupFile(group.id)!;

        expect(file.title).toBe('Pair');
        expect(file.modules[0]).toMatchObject({
            sends: [1],
            namedSends: { 1: ['side'] },
            position: [0, 0],
        });
        expect(file.modules[1]).toMatchObject({ position: [150, 24] });
        expect(file.modules[1].sends).toBeUndefined(); // the part output is outside
    });

    it('imports a group file as new, unwired, independent modules', async () => {
        const doc = new Document();
        const { source, result } = chain(doc);
        const group = doc.createGroup(
            'Pair',
            [source.id, result.id],
            new Map([
                [source.id, { x: 0, y: 0 }],
                [result.id, { x: 100, y: 0 }],
            ])
        )!;
        const file = parseGroupFile(stringifyGroupFile(doc.groupFile(group.id)!));
        const copy = await doc.insertGroupFile(file, { x: 500, y: 500 });

        const [a, b] = copy.moduleIds.map((id) => doc.findModule(id)!);
        expect(a.sends).toEqual([b.id]);
        expect(b.sends).toEqual([]);
        expect(b.graphPos).toEqual({ x: 600, y: 500 });
        edit(doc, a.id, 'changed');
        expect(contentsOf(doc, source.id)).toBe('a');
    });

    it('refuses a group file with a module type this eo3 lacks', async () => {
        const doc = new Document();
        await expect(
            doc.insertGroupFile({
                eo3: 'group',
                version: 1,
                title: 'Future',
                modules: [{ plugin: 'source.future', data: null }],
            })
        ).rejects.toThrow(/source\.future/);
    });

    it('rejects files that are not group files', () => {
        expect(() => parseGroupFile('{}')).toThrow(/isn’t an eo3 group/);
        expect(() => parseGroupFile('nope')).toThrow(/JSON/);
    });

    it('ships examples that import cleanly and avoid the reserved eo3- prefix', async () => {
        const { EXAMPLE_GROUPS } = await import('../../src/groups/examples');
        for (const file of EXAMPLE_GROUPS) {
            expect(JSON.stringify(file)).not.toMatch(/\beo3-/);
            const doc = new Document();
            const group = await doc.insertGroupFile(parseGroupFile(stringifyGroupFile(file)));
            expect(group.moduleIds).toHaveLength(file.modules.length);
            for (const id of group.moduleIds) {
                const module = doc.findModule(id)!;
                expect(module.sends.every((target) => group.moduleIds.includes(target))).toBe(true);
                expect(
                    [...module.namedSends.keys()].every((target) =>
                        group.moduleIds.includes(target)
                    )
                ).toBe(true);
            }
        }
    });
});

describe('saving and loading groups', () => {
    it.each(['toml', 'json'])('round-trips groups (%s)', (format) => {
        const doc = new Document();
        const { source, result } = chain(doc);
        doc.createGroup('Pair', [source.id, result.id]);

        const loaded = deserializeV1(serializeV1(doc, format));
        expect(loaded.groups.map((g) => [g.id, g.title, g.moduleIds.length])).toEqual(
            doc.groups.map((g) => [g.id, g.title, 2])
        );
    });

    it('reads shared definitions from older files as independent groups', () => {
        const doc = new Document();
        const { source, result } = chain(doc);
        const saved = JSON.parse(serializeV1(doc, 'json'));
        const indexOf = (id: string) => doc.modules.findIndex((m) => m.id === id);
        saved.groupDefinitions = [{ id: 'd', title: 'Letter', shelfKey: 'letter' }];
        saved.groupInstances = [
            {
                id: 'i',
                definitionId: 'd',
                partId: 'p',
                modules: [indexOf(source.id), indexOf(result.id)],
            },
        ];
        const loaded = deserializeV1(JSON.stringify(saved));
        expect(loaded.groups).toEqual([
            { id: 'i', title: 'Letter', moduleIds: [loaded.modules[1].id, loaded.modules[2].id] },
        ]);
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
        await addExample(doc, 'Letter');
        expect(doc.splittableContent(part.id)).toHaveProperty('reason');
        expect(doc.splitPart(part.id, 'a', 'b')).toBeNull();
    });

    it('does not rewrite a text source shared with another part or group', async () => {
        const { doc, part, text } = await oneChapter('<p>one</p><p>two</p>');
        const second = doc.addPart();
        const shared = doc.findModule(text.id)!.shallowClone();
        shared.sends = [part.outputId, second.outputId];
        doc.insertModule(shared);
        expect(doc.splittableContent(part.id)).toHaveProperty('reason');
        expect(doc.splitPart(part.id, '<p>one</p>', '<p>two</p>')).toBeNull();

        const local = doc.findModule(text.id)!.shallowClone();
        local.sends = [part.outputId];
        doc.insertModule(local);
        const extra = new Module(TEXT, { contents: '', language: 'css' }) as unknown as AnyModule;
        doc.insertModule(extra);
        expect(doc.createGroup('Text', [text.id, extra.id])).not.toBeNull();
        expect(doc.splittableContent(part.id)).toHaveProperty('reason');
    });
});
