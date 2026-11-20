import { useId, useMemo } from 'react';
import { scopeCanvasCss } from '../../editor/canvas-css';
import { renderCustomTemplateHtml, type CssPiece } from '../../editor/css-pieces';
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
    'kind' | 'className' | 'previewSample' | 'css' | 'templateHtml' | 'previewHtml' | 'previewCss'
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

        const tpl =
            piece.templateHtml?.trim() || `<div class="${safeClass}"><p>{{selection}}</p></div>`;
        return renderCustomTemplateHtml(tpl, sample, sample);
    }, [
        piece.kind,
        piece.className,
        piece.previewSample,
        piece.templateHtml,
        piece.previewHtml,
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
