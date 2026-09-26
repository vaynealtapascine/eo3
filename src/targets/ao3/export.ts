import { SiteTargetExportInput, SiteTargetExportOutput, PushError } from '../types';
import { RenderConfig } from './config';
import { renderAo3Content, cleanWorkskinCss } from './render';

/**
 * Chapter HTML + Work Skin CSS, both from the ported AO3 pipelines. HTML diagnostics were already
 * reported by renderFallback; workskin rejections are reported here (AO3 refuses to save a skin
 * with any). The skin is in AO3's canonical form (prefixed with `#workskin`, one declaration per
 * line), so what the user pastes is what AO3 stores.
 */
export function exportPost(
    { source, css }: SiteTargetExportInput<RenderConfig>,
    pushError: PushError
): SiteTargetExportOutput {
    const { html, css: liftedCss } = renderAo3Content(source);
    const workskin = cleanWorkskinCss([css.trim(), liftedCss].filter(Boolean).join('\n\n'), {
        prefix: '#workskin',
        onDiagnostic: (d) => pushError(`css-${d.kind}`, d),
    });
    return new Map([
        ['html', html],
        ['css', workskin.trimEnd()],
    ]);
}
