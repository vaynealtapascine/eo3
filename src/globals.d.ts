/// <reference types="vite/client" />

declare module '*.css' {}
declare module '*.scss' {}
declare module '*.less' {}

/** Build-time values from vite.config.js (`CONFIG`). */
declare module 'eo3:config' {
    export const cohostStaticUrlPrefix: string;
    export const gitCommitHash: string;
}
