/**
 * Registered with `node --import`, before any test loads.
 *
 * Node resolves ESM specifiers literally; Vite and `moduleResolution: bundler`
 * let the source write `./api` and mean `./api.ts`. This bridges the two so
 * `node --test` runs the same files the bundler does, with no build step and no
 * dependency — the frontend has none, and the tests are not the place to start.
 */

import { registerHooks } from "node:module";

const HAS_EXTENSION = /\.[a-z]+$/i;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !HAS_EXTENSION.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        // Not a TypeScript module after all — fall through to Node's own answer.
      }
    }
    return next(specifier, context);
  },
});
