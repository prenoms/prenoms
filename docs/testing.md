# Testing

Four layers, none of which needs a server you started yourself, and none of
which needs a dependency the project does not already have.

| Layer      | Runner                | Command              | What it covers                                    |
| ---------- | --------------------- | -------------------- | ------------------------------------------------- |
| Frontend   | `node --test`         | `just test-frontend` | svelte-check, then the state layer and the Outbox |
| Backend    | plain PHP scripts     | `just test-backend`  | `php -l`, the Session rules, the API over HTTP    |
| Data       | uv single-file script | `just check-data`    | the Prénom List's shape and sort order            |
| Deployed   | `node` + `php -S`     | `just e2e`           | the staged tree: rewrites, base, cache, isolation |
|            |                       | `just test`          | the first three, plus the build                   |

## Frontend

`just test-frontend` runs `svelte-check` and then Node's built-in test runner
over the TypeScript sources **directly** — no bundler, no test framework.
`frontend/tools/node-test-setup.mjs` is the twenty lines that let Node resolve
the extensionless imports Vite resolves (`./api` meaning `./api.ts`).

Only files matching `src/lib/*.test.ts` run. The pure modules (`duel`,
`shuffle`, `fuzzy`) are testable as-is; `state.svelte.ts` is not, because runes
only compile through Vite — which is why the interesting logic lives outside it.

## Backend

`just test-backend` runs three things:

- `php -l` over every source file. A syntax check with no dependencies, which
  catches the class of mistake that would otherwise surface as a 500 in
  production.
- `tests/unit.php` — the Session rules in isolation: id validation, the merge,
  readiness, Elo.
- `tests/api.php` — a real `php -S` on a throwaway data directory under
  `sys_get_temp_dir()`, driven over HTTP the way `curl` would. It starts and
  stops the server itself and deletes the directory on shutdown.

`tests/harness.php` is the entire framework: `test()`, `assert_equals()`,
`assert_close()`, and an exit code. The host allows no Composer, so there is
nothing to install — and nothing to strip from the release either, since
`tools/stage.sh` copies only `index.php`, `config.php` and `lib/`.

## The deployed shape

`just e2e` builds, stages into a temporary directory laid out as
`<home>/www/`, serves it with `php -S` behind `e2e/smoke-router.php` (which
emulates `root.htaccess`), and runs `e2e/smoke.mjs` against it.

This is the only layer that can catch:

- a wrong Vite `base`, so assets 404 under a subpath;
- a broken `/api` rewrite;
- a Prénom List that 404s, which is a blank app;
- an SPA fallback that misses `/s/{id}`, which is a dead shared link;
- **a Session file landing inside the web root** — the script asserts that the
  JSON lands in `<home>/prenoms-data/` and that nothing under `www/` matches
  `*.json`. That is the whole reason the data directory sits outside the web
  root ([ADR 0003](adr/0003-sessions-on-a-php-backend.md)).

After a real deploy, `just smoke-prod` runs the same assertions against
<https://quelprenom.xyz>. It creates a real Session and leaves it behind; the
twelve-month sweep collects it.

## Ports

Everything binds `127.0.0.1`, never `localhost`: on macOS the latter resolves to
`::1` first, and the IPv4 health checks in `e2e/smoke-deploy.sh` cannot reach a
server listening only on IPv6.

The ports in play are 5173 (Vite dev), 8888 (`just run-backend-local`), 8787
(`backend/tests/api.php`) and 8123 (`just e2e`, override with `PORT=`). A
leftover server on any of them would answer from a stale tree, so
`smoke-deploy.sh` fails loudly rather than testing the wrong build.
