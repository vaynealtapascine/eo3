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

describe('work metadata', () => {
    it.each(['toml', 'json', 'pchost'])('saves the project title and author (%s)', (format) => {
        const doc = new Document();
        doc.setTitle('A story <&>');
        doc.setAuthor('Writer <&>');
        const loaded = deserializeV1(serializeV1(doc, format));
        expect(loaded.title).toBe(doc.title);
        expect(loaded.author).toBe(doc.author);
    });

    it('defaults older projects to an empty author', () => {
        const loaded = deserializeV1(
            JSON.stringify({ version: 1, title: 'Old story', modules: [] })
        );
        expect(loaded.title).toBe('Old story');
        expect(loaded.author).toBe('');
    });

    it('undoes author edits independently of the project title', () => {
        const doc = new Document();
        doc.setTitle('A story');
        doc.setAuthor('Writer');
        doc.setAuthor('Another writer');
        doc.undo();
        expect(doc.author).toBe('');
        expect(doc.title).toBe('A story');
        doc.redo();
        expect(doc.author).toBe('Another writer');
    });
});

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
    it('finishes with the original parts, styles and posting metadata when edited during evaluation', async () => {
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => {
            release = resolve;
        });
        const slow = {
            ...html,
            eval: async () => {
                await waiting;
                return new HtmlData('original');
            },
        };
        const doc = new Document();
        const first = doc.parts[0];
        const second = doc.addPart('Second');
        const styles = mod(css, 'p { color: red; }', [first.outputId]);
        doc.insertModule(mod(slow, '', [first.outputId, second.outputId]));
        doc.insertModule(styles);
        const pending = doc.evalWork();
        doc.removePart(first.id);
        doc.addPart('New');
        doc.removeModule(styles.id);
        doc.setPartPosted('ao3', second.id, {
            at: '2026-09-29',
            classes: [],
            htmlHash: 'new',
            skinCss: 'new',
        });
        release();
        const { work } = await pending;
        expect(work.parts.map((part) => part.id)).toEqual([first.id, second.id]);
        expect(work.parts.map((part) => part.content)).toEqual(['original', 'original']);
        expect(work.parts[0].css).toBe('p { color: red; }');
        expect(work.parts[1].postedTo).toEqual({});
        expect(work.skinBaselines).toEqual({});
        expect(work.cssSources).toEqual([
            { id: styles.id, css: 'p { color: red; }', partIds: [first.id] },
        ]);
    });

    it('does not try to attach old results to a newly added part', async () => {
        const doc = docWith(() => [mod(html, 'original', [MOD_OUTPUT])]);
        const pending = doc.evalWork();
        doc.addPart('Added while rendering');
        const { work } = await pending;
        expect(work.parts).toHaveLength(1);
        expect(work.parts[0].content).toBe('original');
    });
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
        expect(work.cssSources).toEqual([
            { id: doc.modules[0].id, css: '.shared{}', partIds: doc.parts.map((p) => p.id) },
            { id: doc.modules[1].id, css: '.two{}', partIds: [doc.parts[1].id] },
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
            postedTo: {
                ao3: { at: '2026-09-26', classes: ['eo3-h66u19'], htmlHash: 'abc123' },
                'profile:my-site': { at: '2026-09-27', classes: [], htmlHash: 'def456' },
            },
        });

        const loaded = deserializeV1(serializeV1(doc, format));
        expect(loaded.parts.map((p) => [p.id, p.title, p.outputId, p.postedTo])).toEqual(
            doc.parts.map((p) => [p.id, p.title, p.outputId, p.postedTo])
        );
        const loadedStyles = loaded.findModule(loaded.parts[1].stylesModuleId!)!;
        expect(loadedStyles.data).toEqual({ text: '.two{}' });
        expect(loaded.modules[0].sends).toEqual([MOD_OUTPUT, second.outputId]);
    });

    it.each(['toml', 'json'])('keeps posted rules and cleans unused ones (%s)', (format) => {
        const doc = new Document();
        const id = doc.parts[0].id;
        doc.setPartPosted(
            'ao3',
            id,
            {
                at: '2026-09-26',
                classes: ['eo3-used'],
                htmlHash: 'hash',
                skinCss: '#workskin .eo3-used { color: red; }',
            },
            { 'eo3-used': '.eo3-used { color: red; }', 'eo3-unused': '.eo3-unused {}' }
        );
        const loaded = deserializeV1(serializeV1(doc, format));
        expect(loaded.parts[0].postedTo).toEqual(doc.parts[0].postedTo);
        expect(loaded.skinRecordFor('ao3')).toEqual(doc.skinRecordFor('ao3'));

        loaded.cleanupUnusedSkinRules('ao3');
        expect(loaded.skinRecordFor('ao3')).toEqual({ 'eo3-used': '.eo3-used { color: red; }' });
        loaded.undo();
        expect(loaded.skinRecordFor('ao3')).toEqual(doc.skinRecordFor('ao3'));
    });
});

describe('managed part modules', () => {
    it('creates only one styles module for concurrent requests, in one undo step', async () => {
        const doc = new Document();
        const part = doc.parts[0];
        const [first, second] = await Promise.all([
            doc.partStyles(part.id, 'Styles'),
            doc.partStyles(part.id, 'Styles'),
        ]);
        expect(first).toBe(second);
        expect(doc.modules).toHaveLength(1);
        expect(doc.findPart(part.id)?.stylesModuleId).toBe(first);
        doc.undo();
        expect(doc.modules).toHaveLength(0);
        expect(doc.findPart(part.id)?.stylesModuleId).toBeNull();
    });
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

describe('AO3 import', () => {
    it('keeps an imported skin shared as chapters are added', async () => {
        const doc = new Document();
        const skinId = await doc.importWorkSkin(
            'ao3',
            '#workskin .note { color: red; }',
            '#workskin .note { color: red; }',
            {}
        );
        const first = await doc.importChapter('Opening', '<p>First</p>');
        expect(doc.parts).toHaveLength(1);
        expect(first.outputId).toBe(MOD_OUTPUT);

        const second = await doc.importChapter('Next', '<p>Second</p>');
        expect(doc.parts).toHaveLength(2);
        expect(doc.findModule(skinId)!.sends).toEqual([first.outputId, second.outputId]);
        expect(doc.modules.at(-1)!.data).toEqual({ contents: '<p>Second</p>', language: 'html' });

        const third = doc.addPart('Later');
        expect(doc.findModule(skinId)!.sends).toContain(third.outputId);
        const fourth = await doc.addPartWithText('More text');
        expect(doc.findModule(skinId)!.sends).toContain(fourth.outputId);

        const reimported = await doc.importWorkSkin(
            'ao3',
            '.note { color: blue; }',
            '#workskin .note { color: blue; }',
            {}
        );
        expect(reimported).toBe(skinId);
        expect(doc.modules.filter((mod) => mod.id === skinId)).toHaveLength(1);
        expect(doc.findModule(skinId)!.data).toEqual({
            contents: '.note { color: blue; }',
            language: 'css',
        });
        doc.undo();
        expect(doc.findModule(skinId)!.data).toEqual({
            contents: '#workskin .note { color: red; }',
            language: 'css',
        });
    });

    it.each(['toml', 'json'])('round-trips the imported skin reference (%s)', async (format) => {
        const doc = new Document();
        const id = await doc.importWorkSkin(
            'ao3',
            '#workskin .eo3-h66u19 { color: red; }',
            '#workskin .eo3-h66u19 { color: red; }',
            { 'eo3-h66u19': '#workskin .eo3-h66u19 { color: red; }' }
        );
        const loaded = deserializeV1(serializeV1(doc, format));
        const loadedId = loaded.importedSkinModuleId;
        expect(loadedId).toBeTruthy();
        expect(loaded.findModule(loadedId!)!.data).toEqual(doc.findModule(id)!.data);
        expect(loaded.skinRecordFor('ao3')).toEqual(doc.skinRecordFor('ao3'));
        expect(loaded.protectedClassesFor('ao3')).toEqual(['eo3-h66u19']);
        expect(loaded.skinBaselineFor('ao3')).toBe('#workskin .eo3-h66u19 { color: red; }');
        const part = loaded.addPart('Second');
        expect(loaded.findModule(loadedId!)!.sends).toContain(part.outputId);
        loaded.removeModule(loadedId!);
        expect(loaded.importedSkinModuleId).toBeNull();
        expect(loaded.protectedClassesFor('ao3')).toEqual(['eo3-h66u19']);
    });

    it('only prunes imported rules after an explicit selection', async () => {
        const doc = new Document();
        const css = '#workskin .eo3-h66u19 { color: red; }';
        const id = await doc.importWorkSkin('ao3', css, css, { 'eo3-h66u19': css });
        doc.cleanupUnusedSkinRules('ao3');
        expect(doc.skinRecordFor('ao3')).toHaveProperty('eo3-h66u19');
        doc.pruneImportedSkinRules('ao3', ['eo3-h66u19'], '');
        expect(doc.skinRecordFor('ao3')).toEqual({});
        expect(doc.protectedClassesFor('ao3')).toEqual([]);
        expect(doc.findModule(id)!.data).toEqual({ contents: '', language: 'css' });
        doc.undo();
        expect(doc.skinRecordFor('ao3')).toHaveProperty('eo3-h66u19');
    });
});

describe('crossposting', () => {
    it('keeps posted state and the skin record separately for each site', () => {
        const doc = new Document();
        const id = doc.parts[0].id;
        const snapshot = (classes: string[]) => ({ at: '2026-09-26', classes, htmlHash: 'h' });
        doc.setPartPosted('ao3', id, snapshot(['eo3-a']), { 'eo3-a': '.eo3-a {}' });
        doc.setPartPosted('profile:site', id, snapshot(['eo3-b']), { 'eo3-b': '.eo3-b {}' });

        expect(Object.keys(doc.parts[0].postedTo)).toEqual(['ao3', 'profile:site']);
        expect(doc.skinRecordFor('ao3')).toEqual({ 'eo3-a': '.eo3-a {}' });
        expect(doc.skinRecordFor('profile:site')).toEqual({ 'eo3-b': '.eo3-b {}' });

        doc.setPartPosted('ao3', id, null);
        expect(Object.keys(doc.parts[0].postedTo)).toEqual(['profile:site']);
    });

    it('forgets a removed site in one undo step without touching another site', () => {
        const doc = new Document();
        doc.init({
            ...doc.state,
            protectedSkinClasses: { 'profile:retired': ['eo3-protected'] },
        });
        const id = doc.parts[0].id;
        const snapshot = (skinCss: string) => ({
            at: '2026-09-26',
            classes: ['eo3-a'],
            htmlHash: 'h',
            skinCss,
        });
        doc.setPartPosted('ao3', id, snapshot('ao3 css'), { 'eo3-a': '.eo3-a {}' });
        doc.setPartPosted('profile:retired', id, snapshot('profile css'), {
            'eo3-a': '.eo3-a { color: red; }',
        });

        doc.forgetTargetPostingState('profile:retired');
        expect(doc.parts[0].postedTo).toHaveProperty('ao3');
        expect(doc.parts[0].postedTo).not.toHaveProperty('profile:retired');
        expect(doc.state.skinRecords).not.toHaveProperty('profile:retired');
        expect(doc.state.skinBaselines).not.toHaveProperty('profile:retired');
        expect(doc.state.protectedSkinClasses).not.toHaveProperty('profile:retired');
        expect(doc.skinRecordFor('ao3')).toEqual({ 'eo3-a': '.eo3-a {}' });

        doc.undo();
        expect(doc.parts[0].postedTo).toHaveProperty('profile:retired');
        expect(doc.skinBaselineFor('profile:retired')).toBe('profile css');
        expect(doc.protectedClassesFor('profile:retired')).toEqual(['eo3-protected']);
    });

    it('reads files from before crossposting as posted to AO3', () => {
        const doc = deserializeV1(
            JSON.stringify({
                version: 1,
                skinRecord: { 'eo3-a': '.eo3-a {}' },
                skinBaseline: '.eo3-a {}',
                protectedSkinClasses: ['eo3-a'],
                parts: [
                    {
                        id: 'p1',
                        output: 'output',
                        posted: { at: '2026-09-26', classes: ['eo3-a'], htmlHash: 'h' },
                    },
                ],
                modules: [],
            })
        );
        expect(doc.parts[0].postedTo).toEqual({
            ao3: { at: '2026-09-26', classes: ['eo3-a'], htmlHash: 'h' },
        });
        expect(doc.skinRecordFor('ao3')).toEqual({ 'eo3-a': '.eo3-a {}' });
        expect(doc.skinBaselineFor('ao3')).toBe('.eo3-a {}');
        expect(doc.protectedClassesFor('ao3')).toEqual(['eo3-a']);
    });
});
