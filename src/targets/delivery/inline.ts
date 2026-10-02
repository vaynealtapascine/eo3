import { stylesToAttrs, StyleInlinerStats } from '../../plugins/transform/inline-styles-core';
import { PushError, WorkExportInput, WorkExportOutput } from '../types';
import { partCss } from './part-css';

/** Package each part with the CSS that reaches it as inline style attributes. */
export function exportInline<Config>(
    input: WorkExportInput<Config>,
    pushError: PushError,
    renderPart: (source: string, html: string | null) => string,
    scanCss: (css: string, pushError: PushError) => void
): WorkExportOutput {
    const { parts, workCss, cssSources } = input;
    for (const css of cssSources?.map((source) => source.css) ?? [
        workCss,
        ...parts.map((part) => part.css),
    ]) {
        scanCss(css, pushError);
    }

    const outputs = parts.map((part): [string, Map<string, string>] => {
        const html = renderPart(part.source, part.html);
        const css = partCss(input, part);
        return [part.id, new Map([['html', inlineStyles(html, css, pushError)]])];
    });
    return { parts: new Map(outputs), work: new Map() };
}

function inlineStyles(html: string, css: string, pushError: PushError): string {
    const doc = new DOMParser().parseFromString(
        [
            '<!doctype html><html><head><style>',
            css,
            '</style></head><body>',
            html,
            '</body></html>',
        ].join(''),
        'text/html'
    );

    try {
        const stats: StyleInlinerStats = { mode: 'attr', inlinedToNodes: 0, styleTagBytes: 0 };
        stylesToAttrs(doc, stats);
    } catch (err) {
        // Keep the HTML if authored CSS or a pre-existing style attribute is malformed.
        // stylesToAttrs removes <style> tags before parsing, so none remain in the output.
        pushError('invalid-css', { message: (err as Error)?.message ?? String(err) });
    }

    for (const node of doc.querySelectorAll('[class]')) {
        node.removeAttribute('class');
    }

    return doc.body.innerHTML;
}
