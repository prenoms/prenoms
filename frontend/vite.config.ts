import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  // Served at the root of quelprenom.xyz, not from a project subpath.
  base: "/",
  plugins: [svelte()],
  build: { target: "esnext" },
  // In production Apache rewrites /api/* to the PHP entry point; in dev that is
  // `just run-backend-local` on 8888, so the client can call the same paths either way.
  // `127.0.0.1`, never `localhost` — see docs/testing.md: on macOS the latter
  // resolves to ::1 first, and the API next door listens on IPv4 only.
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8888" } },
});
