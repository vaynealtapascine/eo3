import { PushError, SiteTargetExportOutput, WorkExportInput, WorkExportOutput } from '../types';
import { scopeCss } from './scope-css';

export interface SharedStylesheetPart {
    html: string;
    /** CSS rules lifted from this part's HTML. */
    css: string;
}

export function partScopeClass(partId: string): string {
    return `eo3-part-${partId}`;
}

/** Package part HTML and lifted rules with a stylesheet shared by the whole work. */
export function exportSharedStylesheet<Config>(
    { parts, workCss, cssSources }: WorkExportInput<Config>,
    pushError: PushError,
    renderPart: (source: string) => SharedStylesheetPart,
    canonicalize: (css: string, pushError: PushError) => string
): WorkExportOutput {
    const partOutputs = new Map<string, SiteTargetExportOutput>();
    const liftedRules = new Map<string, string>();

    for (const part of parts) {
        const { html, css } = renderPart(part.source);
        const scopedHtml =
            parts.length > 1 ? `<div class="${partScopeClass(part.id)}">${html}</div>` : html;
        partOutputs.set(part.id, new Map([['html', scopedHtml]]));
        for (const rule of css.split('\n').filter(Boolean)) {
            const className = rule.slice(1, rule.indexOf(' '));
            const other = liftedRules.get(className);
            if (other === undefined) liftedRules.set(className, rule);
            else if (other !== rule) {
                pushError('class-collision', { className, styles: [other, rule] });
            }
        }
    }

    const lifted = [...liftedRules.keys()]
        .sort()
        .map((className) => liftedRules.get(className))
        .join('\n');
    // Keep source order: a CSS module may reach several parts without reaching the whole work.
    // When older callers supply only the split CSS strings, treat each part's CSS as one source.
    const authored = cssSources
        ? cssSources.flatMap(({ css, partIds }) =>
              partIds.length === parts.length
                  ? [css]
                  : partIds.map((id) => scopeCss(css, `.${partScopeClass(id)}`))
          )
        : [
              workCss,
              ...parts.map((part) =>
                  parts.length > 1 ? scopeCss(part.css, `.${partScopeClass(part.id)}`) : part.css
              ),
          ];
    const skinSource = [...authored, lifted]
        .map((css) => css.trim())
        .filter(Boolean)
        .join('\n\n');
    const skin = canonicalize(skinSource, pushError);

    return { parts: partOutputs, work: new Map([['css', skin.trimEnd()]]) };
}
