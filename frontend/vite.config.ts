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
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
