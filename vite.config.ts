import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  // GitHub Pages serves the app from /prenoms/ — without this every asset 404s.
  base: "/prenoms/",
  plugins: [svelte()],
  build: { target: "esnext" },
  // In production Apache rewrites /api/* to the PHP entry point; in dev that is
  // `pnpm run dev:api` on 8080, so the client can call the same paths either way.
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
});
