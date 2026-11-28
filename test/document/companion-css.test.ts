import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/components/code-editor', () => ({ CodeEditor: () => null }));
vi.mock('../../src/plugins', () => ({ MODULES: {} }));
import { AnyModule, Document, HtmlData, JsonValue, Module, ModulePlugin } from '../../src/document';
import styleInliner from '../../src/plugins/transform/style-inliner';

/** A module that outputs fixed HTML with a companion stylesheet, like a Svelte component. */
function component(html: string, css: string): AnyModule {
    const plugin = {
        id: 'test.component',
        acceptsInputs: false,
        acceptsNamedInputs: false,
        component: () => null,
        initialData: () => null,
        description: () => 'Component',
        eval: async () => new HtmlData(html, css),
    } as unknown as ModulePlugin<JsonValue>;
    return new Module(plugin);
}

describe('HTML with companion CSS (Svelte component styles)', () => {
    it('sends the HTML to the part and the CSS where CSS modules’ CSS goes', async () => {
        const doc = new Document();
        const second = doc.addPart('Two');
        const mod = component(
            '<div class="conversation-section">hi</div>',
            '.conversation-section { color: red; }'
        );
        mod.sends = [doc.parts[0].outputId];
        doc.insertModule(mod);

        const { work } = await doc.evalWork();
        const [first, other] = work.parts;
        expect(first.content).toBe('<div class="conversation-section">hi</div>');
        expect(first.content).not.toContain('<style');
        expect(first.css).toBe('.conversation-section { color: red; }');
        expect(other.id).toBe(second.id);
        expect(other.css).toBe('');
        expect(work.cssSources).toEqual([
            { id: mod.id, css: '.conversation-section { color: red; }', partIds: [first.id] },
        ]);
    });

    it('becomes work CSS when the component reaches every part', async () => {
        const doc = new Document();
        doc.addPart('Two');
        const mod = component('<p class="a">x</p>', '.a { color: red; }');
        mod.sends = doc.parts.map((part) => part.outputId);
        doc.insertModule(mod);

        const { work } = await doc.evalWork();
        expect(work.workCss).toBe('.a { color: red; }');
        expect(work.parts.map((part) => part.css)).toEqual(['', '']);
    });

    it('adds nothing for an empty stylesheet', async () => {
        const doc = new Document();
        const mod = component('<p>x</p>', '  ');
        mod.sends = [doc.parts[0].outputId];
        doc.insertModule(mod);

        const { work } = await doc.evalWork();
        expect(work.cssSources).toEqual([]);
        expect(work.parts[0].content).toBe('<p>x</p>');
    });

    it('is inlined by the style inliner', async () => {
        const out = await styleInliner.eval(
            { mode: 'attr', keepClasses: true },
            [new HtmlData('<p class="a">x</p>', '.a { color: red; }')],
            new Map(),
            { userData: {} }
        );
        expect(out.into(HtmlData)!.contents).toMatch(/<p class="a" style="color: ?red;?">x<\/p>/);
    });
});
