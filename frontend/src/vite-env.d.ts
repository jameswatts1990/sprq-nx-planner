/// <reference types="vite/client" />

// Injected at build time by Vite's `define` from package.json's version field.
declare const __APP_VERSION__: string;

// Injected at build time by Vite's `define`: the last commit's ISO date/time.
declare const __COMMIT_DATE__: string;
