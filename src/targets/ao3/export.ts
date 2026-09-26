import { WorkExportInput, WorkExportOutput, PushError } from '../types';
import { exportSharedStylesheet } from '../delivery/shared-stylesheet';
import { RenderConfig } from './config';
import { renderAo3Content, cleanWorkskinCss } from './render';

/** Export chapter HTML and one canonical AO3 Work Skin for the whole work. */
export function exportWork(
    input: WorkExportInput<RenderConfig>,
    pushError: PushError
): WorkExportOutput {
    return exportSharedStylesheet(input, pushError, renderAo3Content, (css, report) =>
        cleanWorkskinCss(css, {
            prefix: '#workskin',
            onDiagnostic: (d) => report(`css-${d.kind}`, d),
        })
    );
}
