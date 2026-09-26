import { WorkExportInput, WorkExportOutput, PushError, SiteTargetExportOutput } from '../types';
import { RenderConfig } from './config';
import { renderAo3Content, cleanWorkskinCss } from './render';

/**
 * Chapter HTML for every part, plus one Work Skin shared by all of them, both from the ported
 * AO3 pipelines. The chapter on screen already reported its HTML diagnostics through
 * renderFallback; workskin rejections are reported here (AO3 refuses to save a skin with any).
 *
 * The skin is the authored CSS followed by every chapter's lifted `eo3-*` rules, deduplicated and
 * sorted by class name, in AO3's canonical form (prefixed with `#workskin`, one declaration per
 * line), so what the user pastes is what AO3 stores. Part-only CSS is not scoped to its chapter
 * yet (phase 3).
 */
export function exportWork(
    { parts, workCss }: WorkExportInput<RenderConfig>,
    pushError: PushError
): WorkExportOutput {
    const partOutputs = new Map<string, SiteTargetExportOutput>();
    const liftedRules = new Map<string, string>();

    for (const part of parts) {
        const { html, css } = renderAo3Content(part.source);
        partOutputs.set(part.id, new Map([['html', html]]));
        for (const rule of css.split('\n').filter(Boolean)) {
            const className = rule.slice(1, rule.indexOf(' '));
            const other = liftedRules.get(className);
            if (other === undefined) liftedRules.set(className, rule);
            else if (other !== rule) {
                // Two chapters' different styles hashed to the same class (see lift-styles.ts).
                pushError('class-collision', { className, styles: [other, rule] });
            }
        }
    }

    const lifted = [...liftedRules.keys()]
        .sort()
        .map((className) => liftedRules.get(className))
        .join('\n');
    const skinSource = [workCss, ...parts.map((part) => part.css), lifted]
        .map((css) => css.trim())
        .filter(Boolean)
        .join('\n\n');
    const skin = cleanWorkskinCss(skinSource, {
        prefix: '#workskin',
        onDiagnostic: (d) => pushError(`css-${d.kind}`, d),
    });

    return { parts: partOutputs, work: new Map([['css', skin.trimEnd()]]) };
}
