import { SiteTargetExportAction } from '../types';
import { getExportWarnings } from './fallback-renderer';

export const EXPORT_ACTIONS: SiteTargetExportAction[] = [
    {
        id: 'copy-to-clipboard',
        label: 'Copy to clipboard',
        getData: (markdown) => markdown,
        getWarnings: getExportWarnings,
    },
];
