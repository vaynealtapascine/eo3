import type { Document, ModuleId, WorkOutput } from '../document';
import { formatPieceCssBlock, hasPieceCss, type CssPiece } from './css-pieces';

/**
 * Collects the live CSS reaching `partId` in document module order.
 *
 * Plain CSS modules (`source.shared-styles` and CSS `source.text` modules) are read directly from
 * `document` so edits and newly applied CSS pieces appear on the WYSIWYG canvas immediately (0 ms),
 * while compiled CSS sources (Sass, Less, Svelte blocks, external stylesheets) are merged in from
 * the latest `workOutput`.
 */
export function collectPartLiveCss(
    document: Document,
    partId: string | null,
    workOutput: WorkOutput | null | undefined
): string {
    const part = document.findPart(partId ?? '') ?? document.parts[0];
    if (!part) return '';

    const sharedId = document.sharedStylesModuleId;
    const sharedMod = sharedId ? document.findModule(sharedId) : undefined;
    const sharedReachesPart = !!sharedMod && sharedMod.sends.includes(part.outputId);

    const evaluatedByModule = new Map<ModuleId, string>();
    if (workOutput) {
        for (const source of workOutput.cssSources) {
            if (source.partIds.includes(part.id) && source.css.trim()) {
                evaluatedByModule.set(source.id, source.css);
            }
        }
    }

    const sheets: string[] = [];
    const seenIds = new Set<ModuleId>();

    for (const mod of document.modules) {
        if (mod.plugin.id === 'source.shared-styles') {
            if (!mod.sends.includes(part.outputId)) continue;
            const raw = String((mod.data as { contents?: unknown })?.contents ?? '').trim();
            if (raw) sheets.push(raw);
            seenIds.add(mod.id);
            continue;
        }

        if (mod.plugin.id === 'source.text') {
            const data = mod.data as { language?: unknown; contents?: unknown } | null;
            if (data?.language !== 'css') continue;
            const reaches =
                mod.sends.includes(part.outputId) ||
                (sharedReachesPart && !!sharedId && mod.sends.includes(sharedId));
            if (!reaches) continue;
            const raw = String(data.contents ?? '').trim();
            if (raw) sheets.push(raw);
            seenIds.add(mod.id);
            continue;
        }

        const evalCss = evaluatedByModule.get(mod.id);
        if (evalCss) {
            sheets.push(evalCss);
            seenIds.add(mod.id);
        }
    }

    // Include any remaining evaluated CSS sources (e.g. from groups or dynamically generated ids).
    for (const [id, css] of evaluatedByModule) {
        if (!seenIds.has(id)) sheets.push(css);
    }

    return sheets.join('\n\n');
}

/**
 * Ensures `piece`'s AO3-safe CSS is present in the work's styles reaching `partId`.
 *
 * Prefers the work's "All chapters" (`source.shared-styles`) module when wired to the active part,
 * falling back to the part's own styles module (`partStyles`) if "All chapters" was removed or
 * unwired from this part. Returns `true` when CSS was added, `false` if already present.
 */
export async function ensurePieceCssInDocument(
    document: Document,
    partId: string | null,
    piece: CssPiece
): Promise<boolean> {
    if (!piece.css.trim()) return false;
    const existingCss = collectPartLiveCss(document, partId, null);
    if (hasPieceCss(existingCss, piece)) return false;

    const part = document.findPart(partId ?? '') ?? document.parts[0];
    if (!part) return false;

    if (document.state.sharedStylesModuleId === undefined) {
        await document.ensureSharedStyles();
    }

    const sharedId = document.sharedStylesModuleId;
    const sharedMod = sharedId ? document.findModule(sharedId) : undefined;
    let targetMod =
        sharedMod &&
        sharedMod.plugin.id === 'source.shared-styles' &&
        sharedMod.sends.includes(part.outputId)
            ? sharedMod
            : undefined;

    if (!targetMod) {
        const partStylesId = await document.partStyles(part.id, 'Chapter styles');
        targetMod = partStylesId ? document.findModule(partStylesId) : undefined;
    }

    if (!targetMod) return false;

    const cloned = targetMod.shallowClone();
    const prevData = (cloned.data as { contents?: string; language?: string } | null) ?? {};
    const prevContents = String(prevData.contents ?? '').trimEnd();
    const block = formatPieceCssBlock(piece);
    const nextContents = prevContents ? `${prevContents}\n\n${block}\n` : `${block}\n`;

    cloned.data = { ...prevData, contents: nextContents };
    document.insertModule(cloned);
    return true;
}
