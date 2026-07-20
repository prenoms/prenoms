# Working in this repo

A Svelte 5 SPA (`frontend/`) plus a vanilla PHP 8 JSON API (`backend/`) that
stores one JSON file per Session. Read [`CONTEXT.md`](CONTEXT.md) before
touching anything — the domain language is precise and the code uses it — and
[docs/architecture.md](docs/architecture.md) for where each layer's code goes.

## Hard constraints

- **No Composer, no PHP dependencies, no database.** The deploy target is OVH
  shared hosting with FTP only. If something seems to need a library, write the
  twenty lines instead or raise it before adding one.
- **No runtime frontend dependencies either.** Svelte compiles away; nothing
  else ships.
- **No framework in the backend.** Routing, JSON and storage are `index.php`
  and `lib/`. Keep them small.
- **Svelte 5 runes, not Svelte 4 idioms.** `$state`/`$derived`/`$props`, not
  `writable()`; `onclick`, not `on:click`; callback props, not
  `createEventDispatcher`. Shared state lives in a `.svelte.ts` file, since
  runes only compile there.
- **Nothing is stored on the device.** No localStorage, no export file. The
  Session lives on the server and the link reaches it from any device
  ([ADR 0003](docs/adr/0003-sessions-on-a-php-backend.md)).

## Conventions

- The frontend calls relative URLs (`/api/...`) and only from
  `frontend/src/lib/api.ts`. No host names, no API base URL, no CORS. Vite
  proxies `/api` to PHP in dev; in production both sit under one domain.
- Every response is JSON, including errors: `{error, message}` with a French
  `message` fit to show a user. One shape for the client to handle.
- Session ids are the only authorisation there is. Any id that becomes a
  filename goes through `valid_id()` first — that check is the security
  boundary.
- Session writes are read-modify-write under `flock(LOCK_EX)`. Anything that
  must not lose a concurrent update happens **inside** the lock, server-side
  (this is why the Final Profile's Elo is computed in PHP and the per-Profile
  one is not).
- Bind `127.0.0.1`, never `localhost` — see [docs/testing.md](docs/testing.md).
- `frontend/data/prenoms.csv` is generated *and* hand-edited. Regenerate with
  `just build-data`; it preserves rows INSEE does not produce.

## Before saying you're done

```bash
just test    # frontend check + tests, PHP lint + suites, data check, build
just e2e     # the staged tree, served the way Apache will serve it
```

Add a PHP test for new API behaviour and a `node --test` case for new state
behaviour. Don't mock the API in the frontend tests beyond what
`src/lib/api.test.ts` already does — `just e2e` exists precisely to catch the
wiring that mocks hide.
