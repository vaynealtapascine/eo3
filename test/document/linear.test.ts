import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    AnyModule,
    CssData,
    Document,
    HtmlData,
    instantiateGroupFile,
    Module,
} from '../../src/document';
import { LinearItem, LinearLayout, LinearOrderError } from '../../src/linear';
import { deserializeV1, serializeV1 } from '../../src/storage/versions/v1';
import { parseGroupFile, stringifyGroupFile } from '../../src/storage/group-file';

vi.mock('../../src/plugins', () => ({
    MODULES: Object.fromEntries(
        [
            'source.text',
            'source.shared-styles',
            'source.svelte',
            'source.svelte-component',
            'source.settings',
            'transform.svg-to-background',
            'transform.style-inliner',
            'transform.svgo',
        ].map((id) => [
            id,
            {
                load: async () => ({
                    id,
                    acceptsInputs: id.startsWith('transform.'),
                    acceptsNamedInputs: false,
                    component: () => null,
                    initialData: () => ({ contents: '', language: 'text' }),
                    description: () => id,
                    eval: async () => null,
                }),
            },
        ])
    ),
}));

const plugin = (id: string) =>
    ({ id, acceptsInputs: false, acceptsNamedInputs: false, description: () => id } as any);

function add(doc: Document, id: string, title: string, sends: string[] = []): AnyModule {
    const mod = new Module(plugin(id), {
        contents: title,
        language: 'text',
    }) as unknown as AnyModule;
    mod.title = title;
    mod.sends = sends;
    doc.insertModule(mod);
    return mod;
}

const titles = (doc: Document, items: LinearItem[]) =>
    items.map((item) =>
        item.kind === 'module'
            ? doc.findModule(item.moduleId)!.title
            : doc.findGroup(item.groupId)!.title
    );

function layoutOf(doc: Document): LinearLayout {
    const result = doc.linear;
    if (!('layout' in result)) throw new Error(result.reason);
    return result.layout;
}

/** HTML and CSS into a style inliner, then an SVG optimizer, then the chapter. */
function chain(doc: Document) {
    const inliner = add(doc, 'transform.style-inliner', 'inline', []);
    const svgo = add(doc, 'transform.svgo', 'svgo', ['output']);
    const html = add(doc, 'source.text', 'html', [inliner.id]);
    const css = add(doc, 'source.text', 'css', [inliner.id]);
    doc.insertModule(Object.assign(inliner.shallowClone(), { sends: [svgo.id] }));
    return { inliner, svgo, html, css };
}

/** A workskin-shaped group: text and settings go into a renderer, which sends to the chapter. */
const BLOCK_FILE = {
    eo3: 'group' as const,
    version: 1 as const,
    title: 'Letter',
    inputs: [{ module: 0, label: 'Your text' }],
    modules: [
        {
            plugin: 'source.text',
            title: 'draft',
            data: { contents: '' },
            namedSends: { '2': ['draft'] },
        },
        { plugin: 'source.text', title: 'skin css', data: { contents: '' } },
        { plugin: 'source.svelte', title: 'compose', data: { contents: '' } },
        { plugin: 'source.svelte', title: 'component', data: { contents: '' }, sends: [2] },
    ],
};

describe('linear layout', () => {
    it('lists sources in module order', () => {
        const doc = new Document();
        add(doc, 'source.text', 'a', ['output']);
        add(doc, 'source.text', 'b', ['output']);
        expect(titles(doc, layoutOf(doc).parts[doc.parts[0].id])).toEqual(['a', 'b']);
    });

    it('puts each transform after everything it takes', () => {
        const doc = new Document();
        chain(doc);
        expect(titles(doc, layoutOf(doc).parts[doc.parts[0].id])).toEqual([
            'html',
            'css',
            'inline',
            'svgo',
        ]);
    });

    it('lists a group whose sinks go to one chapter as one block', async () => {
        const doc = new Document();
        const { modules, group } = await instantiateGroupFile(BLOCK_FILE);
        const part = doc.parts[0];
        doc.applyLinearLayout(
            { parts: { [part.id]: [{ kind: 'block', groupId: group.id }] } },
            {
                modules,
                groups: [group],
            }
        );
        expect(titles(doc, layoutOf(doc).parts[part.id])).toEqual(['Letter']);
        // The sinks (skin css and compose) were wired; the rest kept its inner wiring.
        const byTitle = (title: string) => doc.modules.find((mod) => mod.title === title)!;
        expect(byTitle('skin css').sends).toEqual(['output']);
        expect(byTitle('compose').sends).toEqual(['output']);
        expect(byTitle('component').sends).toEqual([byTitle('compose').id]);
        expect([...byTitle('draft').namedSends.values()]).toEqual([new Set(['draft'])]);
    });

    it('leaves managed modules out of the lists and their wiring alone', async () => {
        const doc = new Document();
        add(doc, 'source.text', 'a', ['output']);
        await doc.ensureSharedStyles();
        const shared = doc.sharedStylesModuleId!;
        expect(titles(doc, layoutOf(doc).parts[doc.parts[0].id])).toEqual(['a']);
        const second = doc.addPart();
        doc.applyLinearLayout(layoutOf(doc));
        expect(doc.findModule(shared)!.sends).toEqual(['output', second.outputId]);
    });

    it.each([
        [
            'a named input',
            (doc: Document) => {
                const target = add(doc, 'source.svelte', 'target', ['output']);
                const mod = add(doc, 'source.text', 'side');
                mod.namedSends = new Map([[target.id, new Set(['x'])]]);
            },
            /named input/,
        ],
        [
            'an unwired module',
            (doc: Document) => add(doc, 'source.text', 'loose'),
            /isn’t connected/,
        ],
        [
            'one module reaching a chapter twice',
            (doc: Document) => {
                const inliner = add(doc, 'transform.style-inliner', 'inline', ['output']);
                add(doc, 'source.text', 'twice', [inliner.id, 'output']);
            },
            /same chapter twice/,
        ],
        [
            'an effect sent to two chapters',
            (doc: Document) => {
                const part = doc.addPart();
                add(doc, 'transform.svgo', 'svgo', ['output', part.outputId]);
            },
            /effects can’t be mirrored/,
        ],
        [
            'a source sent into another source',
            (doc: Document) => {
                const svelte = add(doc, 'source.svelte', 'app', ['output']);
                add(doc, 'source.text', 'component', [svelte.id]);
            },
            /a list can’t show/,
        ],
        [
            'a transform that skips something above it',
            (doc: Document) => {
                add(doc, 'source.text', 'plain', ['output']);
                const inliner = add(doc, 'transform.style-inliner', 'inline', ['output']);
                add(doc, 'source.text', 'html', [inliner.id]);
            },
            /takes only some/,
        ],
    ])('has no layout with %s', (_, build, reason) => {
        const doc = new Document();
        build(doc);
        const result = doc.linear;
        expect('reason' in result && result.reason).toMatch(reason);
    });

    it('rewires when a transform moves', () => {
        const doc = new Document();
        const { inliner, svgo, html, css } = chain(doc);
        const part = doc.parts[0].id;
        // html, inline, css, svgo: the inliner now takes only the HTML.
        doc.applyLinearLayout({
            parts: {
                [part]: [html, inliner, css, svgo].map((mod) => ({
                    kind: 'module',
                    moduleId: mod.id,
                })),
            },
        });
        expect(doc.findModule(html.id)!.sends).toEqual([inliner.id]);
        expect(doc.findModule(inliner.id)!.sends).toEqual([svgo.id]);
        expect(doc.findModule(css.id)!.sends).toEqual([svgo.id]);
        expect(doc.findModule(svgo.id)!.sends).toEqual(['output']);
        expect(titles(doc, layoutOf(doc).parts[part])).toEqual(['html', 'inline', 'css', 'svgo']);
    });

    it('moves items between chapters and removes items left out, in one undo step', () => {
        const doc = new Document();
        const a = add(doc, 'source.text', 'a', ['output']);
        const b = add(doc, 'source.text', 'b', ['output']);
        const second = doc.addPart();
        const before = doc.state;
        doc.applyLinearLayout({
            parts: {
                [doc.parts[0].id]: [],
                [second.id]: [{ kind: 'module', moduleId: a.id }],
            },
        });
        expect(doc.findModule(b.id)).toBeUndefined();
        expect(doc.findModule(a.id)!.sends).toEqual([second.outputId]);
        expect(titles(doc, layoutOf(doc).parts[second.id])).toEqual(['a']);
        doc.undo();
        expect(doc.state).toBe(before);
    });

    it('keeps group inputs in saved works and group files', async () => {
        const doc = new Document();
        const { modules, group } = await instantiateGroupFile(BLOCK_FILE);
        doc.applyLinearLayout(
            { parts: { [doc.parts[0].id]: [{ kind: 'block', groupId: group.id }] } },
            { modules, groups: [group] }
        );
        const draft = modules[0].id;
        expect(doc.groups[0].inputs).toEqual([{ moduleId: draft, label: 'Your text' }]);

        const file = parseGroupFile(stringifyGroupFile(doc.groupFile(group.id)!));
        expect(file.inputs).toEqual([{ module: 0, label: 'Your text' }]);

        const reopened = await deserializeV1(serializeV1(doc));
        const [reopenedGroup] = reopened.groups;
        const reopenedDraft = reopened.modules.find((mod) => mod.title === 'draft')!;
        expect(reopenedGroup.inputs).toEqual([{ moduleId: reopenedDraft.id, label: 'Your text' }]);

        doc.removeModule(draft);
        expect(doc.groups[0].inputs).toEqual([]);
    });

    it('sets which members a block shows up front, ignoring non-members', async () => {
        const doc = new Document();
        const { modules, group } = await instantiateGroupFile(BLOCK_FILE);
        const outside = add(doc, 'source.text', 'outside', ['output']);
        doc.applyLinearLayout(
            {
                parts: {
                    [doc.parts[0].id]: [
                        { kind: 'module', moduleId: outside.id },
                        { kind: 'block', groupId: group.id },
                    ],
                },
            },
            { modules, groups: [group] }
        );
        const css = modules[1].id;
        doc.setGroupInputs(group.id, [
            { moduleId: css, label: '' },
            { moduleId: outside.id, label: 'not a member' },
        ]);
        expect(doc.groups[0].inputs).toEqual([{ moduleId: css, label: '' }]);
        doc.setGroupInputs(group.id, []);
        expect('inputs' in doc.groups[0]).toBe(false);
    });
});

describe('mirrored items', () => {
    const mod = (m: AnyModule): LinearItem => ({ kind: 'module', moduleId: m.id });

    it('lists one module sent to two chapters in both', () => {
        const doc = new Document();
        const second = doc.addPart();
        add(doc, 'source.text', 'only first', ['output']);
        add(doc, 'source.text', 'both', ['output', second.outputId]);
        const layout = layoutOf(doc);
        expect(titles(doc, layout.parts[doc.parts[0].id])).toEqual(['only first', 'both']);
        expect(titles(doc, layout.parts[second.id])).toEqual(['both']);
    });

    it('mirrors a block as one group sending to each chapter', async () => {
        const doc = new Document();
        const second = doc.addPart();
        const { modules, group } = await instantiateGroupFile(BLOCK_FILE);
        const block: LinearItem = { kind: 'block', groupId: group.id };
        doc.applyLinearLayout(
            { parts: { [doc.parts[0].id]: [block], [second.id]: [block] } },
            { modules, groups: [group] }
        );
        const byTitle = (title: string) => doc.modules.find((m) => m.title === title)!;
        expect(doc.groups).toHaveLength(1);
        expect(doc.modules).toHaveLength(4);
        expect(byTitle('compose').sends).toEqual(['output', second.outputId]);
        expect(byTitle('skin css').sends).toEqual(['output', second.outputId]);
        expect(byTitle('component').sends).toEqual([byTitle('compose').id]);
        const layout = layoutOf(doc);
        expect(layout.parts[doc.parts[0].id]).toEqual([block]);
        expect(layout.parts[second.id]).toEqual([block]);
    });

    it('wires a mirror into an effect in one chapter and straight to the other', () => {
        const doc = new Document();
        const second = doc.addPart();
        const shared = add(doc, 'source.text', 'shared', ['output']);
        const inliner = add(doc, 'transform.style-inliner', 'inline', ['output']);
        const first = doc.parts[0].id;
        doc.applyLinearLayout({
            parts: { [first]: [mod(shared), mod(inliner)], [second.id]: [mod(shared)] },
        });
        expect(doc.findModule(shared.id)!.sends).toEqual([inliner.id, second.outputId]);
        expect(titles(doc, layoutOf(doc).parts[first])).toEqual(['shared', 'inline']);
        expect(titles(doc, layoutOf(doc).parts[second.id])).toEqual(['shared']);
    });

    it('orders chapters around shared items and refuses opposite orders', () => {
        const doc = new Document();
        const second = doc.addPart();
        const [a, b, m, n] = ['a', 'b', 'm', 'n'].map((t) =>
            add(doc, 'source.text', t, ['output'])
        );
        const first = doc.parts[0].id;
        // m then a in the first chapter, b then m in the second: one order is b, m, a.
        doc.applyLinearLayout({
            parts: { [first]: [mod(m), mod(a), mod(n)], [second.id]: [mod(b), mod(m), mod(n)] },
        });
        expect(titles(doc, layoutOf(doc).parts[first])).toEqual(['m', 'a', 'n']);
        expect(titles(doc, layoutOf(doc).parts[second.id])).toEqual(['b', 'm', 'n']);
        const before = doc.state;
        expect(() =>
            doc.applyLinearLayout({
                parts: { [first]: [mod(m), mod(n)], [second.id]: [mod(n), mod(m)] },
            })
        ).toThrow(LinearOrderError);
        expect(doc.state).toBe(before);
    });
    it('renders a mirror in each chapter and lists its CSS once', async () => {
        const doc = new Document();
        const second = doc.addPart();
        const source = (id: string, data: () => unknown) =>
            ({
                id,
                acceptsInputs: false,
                acceptsNamedInputs: false,
                description: () => id,
                eval: async () => data(),
            } as any);
        const html = new Module(
            source('source.text', () => new HtmlData('<p>shared</p>')),
            {}
        );
        const css = new Module(
            source('source.text', () => new CssData('.shared{color:red}')),
            {}
        );
        for (const m of [html, css]) doc.insertModule(m as unknown as AnyModule);
        const item = (m: { id: string }): LinearItem => ({ kind: 'module', moduleId: m.id });
        doc.applyLinearLayout({
            parts: {
                [doc.parts[0].id]: [item(html), item(css)],
                [second.id]: [item(html), item(css)],
            },
        });
        const { work } = await doc.evalWork();
        expect(work.parts.map((part) => part.content)).toEqual(['<p>shared</p>', '<p>shared</p>']);
        const shared = work.cssSources.filter((s) => s.css.includes('.shared'));
        expect(shared).toHaveLength(1);
        expect(shared[0].partIds).toEqual(doc.parts.map((part) => part.id));
    });

    it('removes a chapter with what only it lists, keeping mirrors, in one undo step', () => {
        const doc = new Document();
        const second = doc.addPart();
        const only = add(doc, 'source.text', 'only second', [second.outputId]);
        const shared = add(doc, 'source.text', 'shared', ['output', second.outputId]);
        const before = doc.state;
        doc.removePartAndContent(second.id);
        expect(doc.parts).toHaveLength(1);
        expect(doc.findModule(only.id)).toBeUndefined();
        expect(doc.findModule(shared.id)!.sends).toEqual(['output']);
        expect(titles(doc, layoutOf(doc).parts[doc.parts[0].id])).toEqual(['shared']);
        doc.undo();
        expect(doc.state).toBe(before);
    });
});

describe('bundled examples in the simple editor', () => {
    const files = fs
        .readdirSync('assets/examples')
        .filter((file) => file === 'default.toml' || file.startsWith('ao3-'));

    it.each(files)('%s has a layout', (file) => {
        const doc = deserializeV1(fs.readFileSync(`assets/examples/${file}`, 'utf8'));
        const items = layoutOf(doc).parts[doc.parts[0].id];
        if (file.startsWith('ao3-')) {
            // One block: the writing, its details and the renderer; the skin is "All chapters".
            expect(items).toEqual([{ kind: 'block', groupId: doc.groups[0].id }]);
            expect(doc.groups[0].inputs?.map((input) => input.label)).toEqual([
                'Details',
                'Your text',
            ]);
        } else {
            expect(items).toHaveLength(4);
        }
    });
});
