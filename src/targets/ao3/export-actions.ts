import { SiteTargetExportAction } from '../types';
import { getExportWarnings } from './fallback-renderer';

export const EXPORT_ACTIONS: SiteTargetExportAction[] = [
    {
        id: 'copy-html',
        label: 'Copy HTML',
        getData: (markdown) => markdown,
        getWarnings: getExportWarnings,
    },
    {
        id: 'copy-workskin',
        label: 'Copy Workskin CSS',
        getData: (markdown) => markdown,
        getWarnings: getExportWarnings,
    },
];
