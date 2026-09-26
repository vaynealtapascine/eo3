import { describe, expect, it, vi } from 'vitest';

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
import {
    CssData,
    Document,
    HtmlData,
    MOD_OUTPUT,
    Module,
    ModulePlugin,
    AnyModule,
} from '../../src/document';
import { serializeV1, deserializeV1 } from '../../src/storage/versions/v1';

let evalCount = 0;
function plugin(id: string, make: (text: string) => HtmlData | CssData): ModulePlugin<any> {
    return {
        id,
        acceptsInputs: false,
        acceptsNamedInputs: false,
        component: () => null,
        initialData: () => ({ text: '' }),
        description: () => id,
        eval: async (data: { text: string }) => {
            evalCount++;
            return make(data.text);
        },
    };
}
const html = plugin('test.html', (t) => new HtmlData(t));
const css = plugin('test.css', (t) => new CssData(t));

function mod(p: ModulePlugin<any>, text: string, sends: string[]): AnyModule {
    const m = new Module(p, { text });
    m.sends = sends;
    return m;
}

function docWith(build: (doc: Document) => AnyModule[]) {
    const doc = new Document();
    const modules = build(doc);
    doc.init({ ...doc.state, modules });
    return doc;
}

describe('a single-part document', () => {
    it('evaluates like before: content joined, all CSS as work CSS', async () => {
        const doc = docWith(() => [
            mod(html, '<p>a</p>', [MOD_OUTPUT]),
            mod(css, '.a{}', [MOD_OUTPUT]),
            mod(html, '<p>b</p>', [MOD_OUTPUT]),
        ]);
        const { work } = await doc.evalWork();
        expect(work.parts).toHaveLength(1);
        expect(work.parts[0].content).toBe('<p>a</p>\n<p>b</p>');
        expect(work.workCss).toBe('.a{}');
        expect(work.parts[0].css).toBe('');
    });
});

describe('a multi-part document', () => {
    function twoParts() {
        const doc = new Document();
        const second = doc.addPart('Chapter 2');
        const [first] = doc.parts;
        const shared = mod(css, '.shared{}', [first.outputId, second.outputId]);
        const onlySecond = mod(css, '.two{}', [second.outputId]);
        const text = mod(html, 'hi', [first.outputId, second.outputId]);
        doc.insertModule(shared);
        doc.insertModule(onlySecond);
        doc.insertModule(text);
        return { doc, first, second, onlySecond };
    }

    it('splits CSS by reach and evaluates shared modules once', async () => {
        const { doc } = twoParts();
        evalCount = 0;
        const { work } = await doc.evalWork();
        expect(evalCount).toBe(3);
        expect(work.workCss).toBe('.shared{}');
        expect(work.parts.map((p) => [p.title, p.content, p.css])).toEqual([
            ['', 'hi', ''],
            ['Chapter 2', 'hi', '.two{}'],
        ]);
    });

    it('removes a part with its sends and managed styles module, but never the last part', () => {
        const { doc, second, onlySecond } = twoParts();
        doc.updatePart(second.id, { stylesModuleId: onlySecond.id });
        doc.removePart(second.id);
        expect(doc.parts).toHaveLength(1);
        expect(doc.findModule(onlySecond.id)).toBeUndefined();
        expect(doc.modules.every((m) => !m.sends.includes(second.outputId))).toBe(true);
        doc.removePart(doc.parts[0].id);
        expect(doc.parts).toHaveLength(1);
    });

    it('detaches a part from its styles module when that module is removed', () => {
        const { doc, second, onlySecond } = twoParts();
        doc.updatePart(second.id, { stylesModuleId: onlySecond.id });
        doc.removeModule(onlySecond.id);
        expect(doc.findPart(second.id)!.stylesModuleId).toBeNull();
    });

    it('reorders parts and undoes part edits', () => {
        const { doc, second } = twoParts();
        doc.movePart(second.id, 0);
        expect(doc.parts[0].id).toBe(second.id);
        doc.undo();
        expect(doc.parts[1].id).toBe(second.id);
    });
});

describe('saving and loading parts', () => {
    it('reads an older file without parts as one part on the output', () => {
        const doc = deserializeV1(
            '{"version":1,"modules":[{"plugin":"source.text","data":{},"sends":["output"]}]}'
        );
        expect(doc.parts).toHaveLength(1);
        expect(doc.parts[0].outputId).toBe(MOD_OUTPUT);
        expect(doc.modules[0].sends).toEqual([MOD_OUTPUT]);
    });

    it('does not write parts for a single untouched part', () => {
        const doc = docWith(() => [mod(html, 'x', [MOD_OUTPUT])]);
        expect(serializeV1(doc, 'json')).not.toContain('parts');
    });

    it.each(['toml', 'json'])('round-trips parts, part sends and styles modules (%s)', (format) => {
        const doc = new Document();
        const second = doc.addPart('Chapter 2');
        const styles = mod(css, '.two{}', [second.outputId]);
        doc.insertModule(mod(html, 'hi', [MOD_OUTPUT, second.outputId]));
        doc.insertModule(styles);
        doc.updatePart(second.id, {
            stylesModuleId: styles.id,
            posted: { at: '2026-09-26', classes: ['eo3-h66u19'], htmlHash: 'abc123' },
        });

        const loaded = deserializeV1(serializeV1(doc, format));
        expect(loaded.parts.map((p) => [p.id, p.title, p.outputId, p.posted])).toEqual(
            doc.parts.map((p) => [p.id, p.title, p.outputId, p.posted])
        );
        const loadedStyles = loaded.findModule(loaded.parts[1].stylesModuleId!)!;
        expect(loadedStyles.data).toEqual({ text: '.two{}' });
        expect(loaded.modules[0].sends).toEqual([MOD_OUTPUT, second.outputId]);
    });
});

describe('managed part modules', () => {
    it('adds a part with a text module wired to it, undone in one step', async () => {
        const doc = new Document();
        const part = await doc.addPartWithText('Chapter text');
        const text = doc.modules.find((m) => m.sends.includes(part.outputId))!;
        expect(text.title).toBe('Chapter text');
        doc.undo();
        expect(doc.parts).toHaveLength(1);
        expect(doc.modules).toHaveLength(0);
    });

    it('creates part styles once, wired to the part, and again after detaching', async () => {
        const doc = new Document();
        const part = doc.addPart();
        const first = await doc.partStyles(part.id, 'Chapter styles');
        expect(await doc.partStyles(part.id, 'Chapter styles')).toBe(first);
        expect(doc.findModule(first!)!.sends).toEqual([part.outputId]);

        doc.updatePart(part.id, { stylesModuleId: null });
        const second = await doc.partStyles(part.id, 'Chapter styles');
        expect(second).not.toBe(first);
        expect(doc.findModule(first!)).toBeDefined();
    });
});
