import { PushError, SiteTargetExportOutput, WorkExportInput, WorkExportOutput } from '../types';
import { scopeCss } from './scope-css';
import { scanCrossPartConflicts } from './css-conflicts';
import { liftedSkinRules } from './skin-record';

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
    { parts, workCss, cssSources, skinRecord, protectedSkinClasses }: WorkExportInput<Config>,
    pushError: PushError,
    renderPart: (source: string) => SharedStylesheetPart,
    canonicalize: (css: string, pushError: PushError) => string
): WorkExportOutput {
    const partOutputs = new Map<string, SiteTargetExportOutput>();
    const liftedRules = new Map<string, string>();
    const scopedPartIds = new Set(
        cssSources
            ? cssSources
                  .filter((source) => source.partIds.length < parts.length && source.css.trim())
                  .flatMap((source) => source.partIds)
            : parts.filter((part) => part.css.trim()).map((part) => part.id)
    );

    for (const part of parts) {
        const { html, css } = renderPart(part.source);
        const scopedHtml = scopedPartIds.has(part.id)
            ? `<div class="${partScopeClass(part.id)}">${html}</div>`
            : html;
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

    if (cssSources && parts.length > 1) {
        scanCrossPartConflicts(
            cssSources,
            parts.map((part) => part.id),
            pushError
        );
    }

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
    const authoredClasses = new Set(Object.keys(liftedSkinRules(authored.join('\n\n'))));
    const retained = new Set([
        ...parts.flatMap((part) => part.posted?.classes ?? []),
        ...(protectedSkinClasses ?? []),
    ]);
    for (const [className, rule] of Object.entries(skinRecord ?? {})) {
        if (
            retained.has(className) &&
            !liftedRules.has(className) &&
            !authoredClasses.has(className)
        ) {
            liftedRules.set(className, rule);
        }
    }
    const lifted = [...liftedRules.keys()]
        .filter((className) => !authoredClasses.has(className))
        .sort()
        .map((className) => liftedRules.get(className))
        .join('\n');
    const skinSource = [...authored, lifted]
        .map((css) => css.trim())
        .filter(Boolean)
        .join('\n\n');
    const skin = canonicalize(skinSource, pushError);

    return { parts: partOutputs, work: new Map([['css', skin.trimEnd()]]) };
}
