import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  // GitHub Pages serves the app from /prenoms/ — without this every asset 404s.
  base: "/prenoms/",
  plugins: [svelte()],
  build: { target: "esnext" },
});
