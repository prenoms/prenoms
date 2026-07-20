# Architecture

Where each layer's code goes, and what may talk to what. Read
[`CONTEXT.md`](../CONTEXT.md) first — the nouns used here (Prénom, Deck,
Verdict, Shortlist, Duel, Rating, Session, Profile) are defined there and used
precisely.

## The two halves

```
frontend/          Svelte 5 + TypeScript + Vite, no runtime dependencies
  index.html       the shell; also the SPA fallback for every unknown path
  data/            prenoms.csv — the Prénom List, fetched at runtime
  src/App.svelte   picks the screen off the route, then Mode and view switching
  src/views/       Home, Share (the link), Join, then the per-Profile three —
                   Swipe (Cartes), Browse (Parcourir), Game (Duels) — and
                   Final, which replaces them once the Session has merged
  src/components/  Banner, Ready, and the two the per-Profile and Final Duels
                   share: DuelBoard and Ranking
  src/lib/         domain.ts, api.ts, outbox.ts, state.svelte.ts, and the
                   pure helpers: route, shuffle, fuzzy, duel, prenom-list
  tools/           node-test-setup.mjs — lets node --test resolve Vite imports

backend/           vanilla PHP 8.1, no framework, no Composer, no database
  index.php        the whole API: routing off REQUEST_URI, then the handlers
  config.php       the one host-dependent thing: where Session files live
  lib/http.php     request decoding and JSON responses
  lib/ids.php      Session and Profile id generation, and `valid_id()`
  lib/session.php  the Session shape, the merge, the readiness rules
  lib/store.php    one JSON file per Session, under flock(LOCK_EX)
  lib/elo.php      the Rating maths the server owns (Final Profile Duels)
  tests/           plain PHP scripts judged by exit code; harness.php is the
                   entire framework
  .htaccess        deployed as www/server/.htaccess: only index.php answers

e2e/               the staged tree, served the way Apache will serve it
tools/             the Prénom List builders, plus stage.sh and deploy.sh
```

## The request path

```
PUT /api/sessions/K7M2QX9RTB/profiles/ABCDEFGHJK/verdicts/female/Jeanne
   │
   ├─ Apache (production): root.htaccess rewrites ^api(/.*)?$ to server/index.php
   │  Vite (development):  server.proxy sends /api to php -S on 127.0.0.1:8888
   │
   ├─ backend/index.php
   │     segments()            splits the path, *then* decodes each segment
   │     require_session_id()  valid_id() — the security boundary; an id is
   │                           about to become a filename
   │     handle()              matches method + shape, validates the body
   │
   ├─ lib/store.php
   │     with_session($id, fn) opens the file, flock(LOCK_EX), decodes, calls
   │                           the closure, re-encodes, writes, unlocks
   │
   └─ lib/http.php
         json($status, $body)  every response, including errors
```

There is no router object and no route table: the API is a dozen endpoints,
matched by shape in `handle()`. Keep it that way until it hurts.

## Rules that are not obvious

**Everything that must not lose a concurrent update happens inside the lock,
in PHP.** That is why the Final Profile's Elo is computed server-side
(`POST /final/duels` sends winner and loser, not ratings) while the private
per-Profile Ranking is computed in the browser and `PUT` whole: only the Final
Profile has two people writing to it at once.

**A Profile's Verdicts never leave the server before the merge.**
`GET /sessions/{id}` returns who has joined and whether they are ready, and
nothing else. Adding a field there is a product decision, not a convenience.

**The frontend calls relative URLs and only from `src/lib/api.ts`.** No host
names, no API base URL, no CORS — dev proxies, production shares an origin.

**Writes are optimistic, through the `Outbox`.** A swipe lands in `$state`
immediately; `outbox.ts` carries the request behind it, keyed by what the write
is *about* (`verdict:female:Jeanne`), so a later write for the same key replaces
an unsent earlier one. It holds nothing across a tab close — that is deliberate
([ADR 0003](adr/0003-sessions-on-a-php-backend.md)), and when the connection
stays broken the banner says so rather than pretending.

**The Session id is in the path, the view is in the hash.**
`/s/K7M2QX9RTB#/swipe`. The path part is the link two parents pass around, so it
has to be a real URL that survives a cold visit — which is what the SPA fallback
in `root.htaccess` is for. The hash is this tab's business and nobody else's.
`route.ts` is the pure half and is tested; `state.svelte.ts` holds the reactive
`route` and refills the cache on every navigation, including Back.

**A merged Session needs no Profile.** The Final Profile belongs to the Session,
so `App.svelte` sends anyone holding the link straight to `Final.svelte` and
never asks who they are. Before the merge the join screen always asks, because
the only thing the device remembers is the current tab's Profile pick, in
`sessionStorage`.

**`POST /final/duels` is the one write that is never retried.** Every other
endpoint is idempotent, which is what makes the Outbox safe; this one applies an
Elo adjustment per call, so a retry after a lost response would count the Duel
twice. `resolveFinalDuel` sends them one at a time, outside the Outbox, and says
so out loud when one is lost — a Duel silently played twice is worse than one
openly dropped.

**`state.svelte.ts` is a cache of server state, not a store.** Runes only
compile in `.svelte.ts` files, which is why the state layer is one; the pure
logic it uses (`duel.ts`, `shuffle.ts`, `fuzzy.ts`) has no runes and is tested
directly.

**The Prénom List is data, not code.** `frontend/data/prenoms.csv` is imported
with `?url` and fetched at runtime, so Vite fingerprints it and Apache caches it
for a year. It is generated by `tools/build_prenoms.py` and hand-edited
afterwards; `tools/check_prenoms.py` guards its shape in CI.

## Adding a feature

1. Name it in [`CONTEXT.md`](../CONTEXT.md) if it introduces a concept.
2. If it changes what the server stores, change `lib/session.php` and add a
   case to `backend/tests/unit.php`; if it adds an endpoint, add it to
   `handle()`, to `backend/tests/api.php`, and to the table in
   [`backend/README.md`](../backend/README.md).
3. Add the wire call to `src/lib/api.ts`, the cache update to
   `src/lib/state.svelte.ts`, and the view last.
4. `just test`, then `just e2e`.
