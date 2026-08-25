import { execSync } from "node:child_process";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import pkg from "./package.json" with { type: "json" };

// Last commit date/time, surfaced next to the version in the navbar so the
// deployed build's age is visible at a glance. Falls back to build time if git
// isn't available (e.g. a source-only checkout).
function commitDate() {
  try {
    return execSync("git log -1 --format=%cI").toString().trim();
  } catch {
    return "";
  }
}

// Dev server proxies /api to the local backend so the app never branches on
// environment - the same relative fetch("/api/...") call works in dev, in the
// docker-compose dev override, and in prod behind nginx.
export default defineConfig({
  plugins: [react()],
  // Surfaced in the navbar (see AppShell). Bump package.json "version" (semver
  // vX.X.X) with each change so the deployed build is identifiable at a glance.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_DATE__: JSON.stringify(commitDate()),
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
    // native fs.watch is unreliable on network/SMB-mapped drives (throws ECONNRESET
    // and crashes the dev server) - polling is slower but stable there. Harmless on a
    // local disk too, just slightly higher CPU use.
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the rarely-changing core framework libs into their own long-lived chunks so
        // they stay cached across deploys (app code changes far more often than these do).
        // Route-specific heavy deps (recharts, read-excel-file) are already split out by the
        // React.lazy route boundaries in App.tsx, so they don't need a manual entry here.
        // Function form (not the object map): vite 8's Rolldown bundler only accepts a
        // manualChunks function, unlike Rollup which took either.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return "react-vendor";
          }
          if (/[\\/]node_modules[\\/]@tanstack[\\/]react-query[\\/]/.test(id)) {
            return "query-vendor";
          }
        },
      },
    },
  },
});
