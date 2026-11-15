import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/plugins', () => ({ MODULES: {} }));
import { Document, HtmlData, Module, ModulePlugin } from '../../src/document';
import { renderInputs, sameRenderInputs } from '../../src/ui/render-inputs';

const plugin: ModulePlugin<any> = {
    id: 'test.html',
    acceptsInputs: false,
    acceptsNamedInputs: false,
    component: () => null,
    initialData: () => ({ text: '' }),
    description: () => 'HTML',
    eval: async (data: { text: string }) => new HtmlData(data.text),
};

function work() {
    const doc = new Document();
    const module = new Module(plugin, { text: '<p>one</p>' });
    module.sends = [doc.parts[0].outputId];
    doc.insertModule(module);
    return { doc, module };
}

/** Whether the preview made from `rendered` no longer matches the document. */
const stale = (doc: Document, rendered: readonly unknown[]) =>
    !sameRenderInputs(rendered, renderInputs(doc));

describe('preview freshness', () => {
    it('ignores edits that never reach the output', () => {
        const { doc, module } = work();
        const rendered = renderInputs(doc);

        doc.setTitle('A new title');
        doc.setAuthor('Someone');
        doc.updatePart(doc.parts[0].id, { title: 'Arrival' });
        const moved = doc.findModule(module.id)!.shallowClone();
        moved.graphPos = { x: 40, y: 80 };
        moved.title = 'Chapter text';
        doc.insertModule(moved);

        expect(stale(doc, rendered)).toBe(false);
    });

    it('notices changed text, wiring, added parts and removed modules, and clears on undo', () => {
        const { doc, module } = work();
        const rendered = renderInputs(doc);

        const edited = doc.findModule(module.id)!.shallowClone();
        edited.data = { text: '<p>two</p>' };
        doc.insertModule(edited);
        expect(stale(doc, rendered)).toBe(true);
        doc.undo();
        expect(stale(doc, rendered)).toBe(false);

        const unwired = doc.findModule(module.id)!.shallowClone();
        unwired.sends = [];
        doc.insertModule(unwired);
        expect(stale(doc, rendered)).toBe(true);
        doc.undo();

        doc.addPart('Second chapter');
        expect(stale(doc, rendered)).toBe(true);
        doc.undo();

        doc.removeModule(module.id);
        expect(stale(doc, rendered)).toBe(true);
        doc.undo();
        expect(stale(doc, rendered)).toBe(false);
    });
});
