import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/components/code-editor', () => ({ CodeEditor: () => null }));
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
        'source.shared-styles': {
            load: async () => (await import('../../src/plugins/source/shared-styles')).default,
        },
    },
}));
import { CssData, Document, HtmlData, moduleDescription } from '../../src/document';
import { deserializeV1, serializeV1 } from '../../src/storage/versions/v1';

async function openWork() {
    const doc = new Document();
    await doc.ensureSharedStyles();
    return doc;
}

function setShared(doc: Document, contents: string) {
    const module = doc.findModule(doc.sharedStylesModuleId!)!.shallowClone();
    module.data = { contents };
    doc.insertModule(module);
}

describe('"All chapters" styles', () => {
    it('is added on open, wired to every part, without an undo step', async () => {
        const doc = new Document();
        doc.addPart('Two');
        const before = doc.history.length;
        await doc.ensureSharedStyles();

        expect(doc.history.length).toBe(before);
        const shared = doc.findModule(doc.sharedStylesModuleId!)!;
        expect(shared.sends).toEqual(doc.parts.map((part) => part.outputId));
        await doc.ensureSharedStyles();
        expect(doc.modules.filter((m) => m.plugin.id === 'source.shared-styles')).toHaveLength(1);
    });

    it('is wired to parts added later, which then get its CSS as work CSS', async () => {
        const doc = await openWork();
        setShared(doc, '.title { color: red; }');
        const added = doc.addPart();

        expect(doc.sharedStylesReach().map((part) => part.id)).toContain(added.id);
        const { work } = await doc.evalWork();
        expect(work.workCss).toBe('.title { color: red; }');
    });

    it('passes on CSS sent into it before its own, and rejects anything else', async () => {
        const plugin = (await import('../../src/plugins/source/shared-styles')).default;
        const out = await plugin.eval({ contents: 'b {}' }, [new CssData('a {}')], new Map(), {
            userData: {},
        });
        expect(out.into(CssData)!.contents).toBe('a {}\nb {}');
        await expect(
            plugin.eval({ contents: '' }, [new HtmlData('<p>')], new Map(), { userData: {} })
        ).rejects.toThrow(/only accepts CSS/);
    });

    it('names itself by the parts it reaches', async () => {
        const doc = await openWork();
        doc.addPart();
        const shared = () => doc.findModule(doc.sharedStylesModuleId!)!;
        expect(moduleDescription(doc, shared(), 'Chapter')).toBe('All chapters');

        const unwired = shared().shallowClone();
        unwired.sends = unwired.sends.slice(1);
        doc.insertModule(unwired);
        expect(moduleDescription(doc, shared(), 'Chapter')).toBe('1 of 2 chapters');
    });

    it('adds no CSS while empty', async () => {
        const doc = await openWork();
        const { work } = await doc.evalWork();
        expect(work.workCss).toBe('');
        expect(work.cssSources).toEqual([]);
    });

    it('stays deleted once the author removes it', async () => {
        const doc = await openWork();
        doc.removeModule(doc.sharedStylesModuleId!);
        const reopened = deserializeV1(serializeV1(doc));
        await reopened.ensureSharedStyles();
        expect(reopened.sharedStylesModuleId).toBeNull();
        expect(reopened.modules).toHaveLength(0);
    });

    it('round-trips through saving', async () => {
        const doc = await openWork();
        setShared(doc, 'p {}');
        const reopened = deserializeV1(serializeV1(doc));
        await reopened.ensureSharedStyles();
        const shared = reopened.findModule(reopened.sharedStylesModuleId!)!;
        expect(shared.data).toEqual({ contents: 'p {}' });
        expect(reopened.modules).toHaveLength(1);
    });
});
