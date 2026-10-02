import { PartExportInput, WorkExportInput } from '../types';

/** CSS reaching one part, in graph module order (which determines the cascade). */
export function partCss<Config>(input: WorkExportInput<Config>, part: PartExportInput): string {
    const sources = input.cssSources
        ? input.cssSources.filter((source) => source.partIds.includes(part.id)).map((s) => s.css)
        : [input.workCss, part.css];
    return sources.filter(Boolean).join('\n');
}
