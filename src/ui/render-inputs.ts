import { Document } from '../document';

/**
 * Everything a render reads from the document, by reference. Document state is immutable, so
 * two snapshots with the same references render the same output; edits that don't reach the
 * output (the work's and chapters' titles, the author, moving or naming nodes, group changes)
 * leave it equal: the preview reads titles from the document, and no site exports them.
 * Used to tell whether the preview is out of date while Live Update is off.
 */
export function renderInputs(doc: Document): readonly unknown[] {
    const { parts, modules, skinRecords, protectedSkinClasses, skinBaselines } = doc.state;
    return [
        skinRecords,
        protectedSkinClasses,
        skinBaselines,
        parts.length,
        ...parts.flatMap((part) => [part.id, part.outputId, part.postedTo]),
        ...modules.flatMap((mod) => [mod.id, mod.plugin, mod.data, mod.sends, mod.namedSends]),
    ];
}

export function sameRenderInputs(a: readonly unknown[], b: readonly unknown[]): boolean {
    return a.length === b.length && a.every((item, i) => item === b[i]);
}
