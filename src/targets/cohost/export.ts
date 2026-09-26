import { WorkExportInput, WorkExportOutput, PushError } from '../types';
import { exportInline } from '../delivery/inline';
import { RenderConfig } from './config';
import { scanCssForWarnings } from '../scan-css';
import { renderMarkdown } from './fallback-renderer';

/** Export each cohost post with its CSS in inline style attributes. */
export function exportWork(
    input: WorkExportInput<RenderConfig>,
    pushError: PushError
): WorkExportOutput {
    return exportInline(
        input,
        pushError,
        (source, html) => html ?? renderMarkdown(source, () => {}),
        scanCssForWarnings
    );
}
