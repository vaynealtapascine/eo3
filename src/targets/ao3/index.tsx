import { SiteTargetPlugin } from '../types';
import { RenderConfig, DEFAULT_RENDER_CONFIG } from './config';
import { handleAsyncErrors, AO3_APPROX_MAX_PAYLOAD_SIZE } from './diagnostics';
import { renderAo3Content } from './render';
import { Ao3PreviewHeader } from './preview-chrome';
import { EXPORT_ACTIONS } from './export-actions';
import { exportWork } from './export';
import './styles.scss';
// @ts-ignore
import mascot from './mascot.svg?raw';

const plugin: SiteTargetPlugin<RenderConfig> = {
    id: 'ao3',
    title: 'Archive of Our Own',

    initialConfig: () => DEFAULT_RENDER_CONFIG,

    // No live renderer: AO3 processes posts server-side, and ./render is a verified port of that.
    // export() runs the same pipeline, so the preview is what gets posted.
    renderFallback: (content, _config, pushError) =>
        renderAo3Content(content, (d) => pushError(d.kind, d)).html,

    scanForAsyncErrors: handleAsyncErrors,

    PreviewHeader: Ao3PreviewHeader,

    disableProseInteraction: true,

    outputs: [
        { id: 'html', label: 'HTML', typeId: 'text/html', scope: 'part' },
        { id: 'css', label: 'Workskin CSS', typeId: 'text/css', scope: 'work' },
    ],

    previewCssScope: '#workskin',

    partLabel: 'Chapter',
    partMaxChars: AO3_APPROX_MAX_PAYLOAD_SIZE,

    export: exportWork,

    exportActions: EXPORT_ACTIONS,

    // AO3 doesn't have a separate mascot pose for each state, so reuse it for both.
    outputMascot: { awake: mascot, asleep: mascot },
};

export default plugin;
