import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev server proxies /api to the local backend so the app never branches on
// environment - the same relative fetch("/api/...") call works in dev, in the
// docker-compose dev override, and in prod behind nginx.
export default defineConfig({
  plugins: [react()],
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
});
