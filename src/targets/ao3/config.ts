/** AO3 has no preview settings; retired fields in old saved configs are ignored. */
export type RenderConfig = Record<string, never>;

export const DEFAULT_RENDER_CONFIG: RenderConfig = {};
