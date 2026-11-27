import { useId, useMemo } from 'react';
import { scopeCanvasCss } from '../../editor/canvas-css';
import { renderStyleTemplate } from '../../editor/style-template';
import type { CssPiece } from '../../editor/css-pieces';
import { sanitizeStyleHtml } from '../../storage/style-file';

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export type StyleSwatchPiece = Pick<
    CssPiece,
    | 'kind'
    | 'className'
    | 'previewSample'
    | 'css'
    | 'templateHtml'
    | 'previewHtml'
    | 'previewCss'
    | 'fields'
> & {
    id?: string;
    custom?: boolean;
};

/**
 * Safely renders a live miniature swatch (or full-size chapter preview) of a custom style using
 * its actual CSS scoped to a unique `[data-eo3-swatch]` attribute and AO3-sanitized HTML.
 */
export function StyleSwatch({
    piece,
    mode = 'compact',
}: {
    piece: StyleSwatchPiece;
    mode?: 'compact' | 'full';
}) {
    const rawId = useId();
    const scopeId = useMemo(() => `sw-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawId]);

    const scopedCss = useMemo(() => {
        const combined =
            mode === 'compact' && piece.previewCss?.trim()
                ? `${piece.css}\n${piece.previewCss}`
                : piece.css;
        if (!combined.trim()) return '';
        return scopeCanvasCss(combined, `[data-eo3-swatch="${scopeId}"]`);
    }, [piece.css, piece.previewCss, mode, scopeId]);

    const html = useMemo(() => {
        const sample = piece.previewSample.trim() || 'Sample';
        const safeClass = escapeHtml(piece.className.trim());

        if (mode === 'compact' && piece.previewHtml?.trim()) {
            return sanitizeStyleHtml(piece.previewHtml).html;
        }

        const template = piece.templateHtml?.trim();
        // Swatches show a field's placeholder ("e.g. I love you" → "I love you") where it has no
        // default, so writers' forms don't start pre-filled just to make a nice preview.
        const previewValues = Object.fromEntries(
            (piece.fields ?? [])
                .filter((f) => f.type !== 'toggle' && f.default === undefined && f.placeholder)
                .map((f) => [f.key, f.placeholder!.replace(/^e\.g\.\s*/i, '')])
        );
        const fromTemplate = (tpl: string) =>
            renderStyleTemplate(tpl, {
                selection: sample,
                fields: piece.fields,
                values: previewValues,
                fallback: sample,
            });

        if (piece.kind === 'inline' && template) {
            // An inline template, filled in with its sample text and field defaults.
            const inline = fromTemplate(template);
            return mode === 'full'
                ? sanitizeStyleHtml(`<p>The quick brown ${inline} jumped over the lazy dog.</p>`)
                      .html
                : inline;
        }

        if (piece.kind === 'inline') {
            if (mode === 'full') {
                return sanitizeStyleHtml(
                    `<p>The quick brown <span class="${safeClass}">${escapeHtml(
                        sample
                    )}</span> jumped over the lazy dog.</p>`
                ).html;
            }
            return sanitizeStyleHtml(`<span class="${safeClass}">${escapeHtml(sample)}</span>`)
                .html;
        }

        if (piece.kind === 'block') {
            return sanitizeStyleHtml(`<div class="${safeClass}"><p>${escapeHtml(sample)}</p></div>`)
                .html;
        }

        return fromTemplate(template || `<div class="${safeClass}"><p>{{selection}}</p></div>`);
    }, [
        piece.kind,
        piece.className,
        piece.previewSample,
        piece.templateHtml,
        piece.previewHtml,
        piece.fields,
        mode,
    ]);

    if (mode === 'full') {
        return (
            <div className={'eo3-style-full-preview is-kind-' + piece.kind}>
                {scopedCss ? <style>{scopedCss}</style> : null}
                <div
                    className="i-full-stage"
                    data-eo3-swatch={scopeId}
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            </div>
        );
    }

    const usesCustomHtml = !!piece.previewHtml?.trim();
    return (
        <span
            className={
                'i-piece-swatch is-live is-kind-' +
                piece.kind +
                (usesCustomHtml ? ' is-custom-html' : '')
            }
            aria-hidden="true"
        >
            {scopedCss ? <style>{scopedCss}</style> : null}
            <span
                className="i-swatch-stage"
                data-eo3-swatch={scopeId}
                dangerouslySetInnerHTML={{ __html: html }}
            />
        </span>
    );
}
