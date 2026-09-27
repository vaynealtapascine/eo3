import { Document, ModuleGroup } from '../../src/document';
import { EXAMPLE_GROUPS } from '../../src/groups/examples';

/** Imports an example group and wires each of its modules to the first part, as an author would. */
export async function addExample(doc: Document, title: string): Promise<ModuleGroup> {
    const group = await doc.insertGroupFile(EXAMPLE_GROUPS.find((g) => g.title === title)!);
    for (const id of group.moduleIds) {
        const module = doc.findModule(id)!.shallowClone();
        module.sends = [doc.parts[0].outputId];
        doc.insertModule(module);
    }
    return group;
}
