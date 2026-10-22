import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * The dashboard build.
 *
 * `base: "./"` so the bundle works wherever the server puts it, and no module preload polyfill or
 * CDN fallback: every byte this page loads is a file next to it. The dev server proxies the API to
 * the local service, which keeps the browser on one origin in development too, so the server's
 * `Host` check and the absence of CORS behave the same as in production.
 */
export default defineConfig({
  base: "./",
  plugins: [react(), tailwind()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Inlining would turn an asset into a data: URL, which is fine, but keeping files on disk makes
    // the "nothing is fetched from anywhere else" test something you can read.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4571",
    },
  },
});
