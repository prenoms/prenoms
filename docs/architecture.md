# Architecture

Where each layer's code goes, and what may talk to what. Read
[`CONTEXT.md`](../CONTEXT.md) first — the nouns used here (Prénom, Deck,
Verdict, Shortlist, Bracket, Duel, Place, Session, Profile) are defined there and used
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
  src/lib/         domain.ts, api.ts, outbox.ts, session-cache.ts (every rule
                   about server state), state.svelte.ts (the runes, the browser
                   and the Deck), and the pure helpers: route, shuffle, fuzzy,
                   duel, prenom-list
  tools/           node-test-setup.mjs — lets node --test resolve Vite imports

backend/           vanilla PHP 8.1, no framework, no Composer, no database
  index.php        the whole API: routing off REQUEST_URI, then the handlers
  config.php       the one host-dependent thing: where Session files live
  lib/http.php     request decoding and JSON responses
  lib/ids.php      Session and Profile id generation, and `valid_id()`
  lib/session.php  the Session shape, the merge, and every rule about what may
                   be done to a Session — the operations `handle()` calls
  lib/store.php    one JSON file per Session, under flock(LOCK_EX)
  lib/bracket.php  the tournament rules the server owns (Final Profile Duels)
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
   ├─ lib/session.php
   │     record_verdict(…)     the rule: refuses after the merge, and after
   │                           this Profile declared itself ready
   │
   └─ lib/http.php
         json($status, $body)  every response, including errors
```

There is no router object and no route table: the API is a dozen endpoints,
matched by shape in `handle()`. Keep it that way until it hurts.

## Rules that are not obvious

**`index.php` decides whether a *request* is well formed; `session.php` decides
whether a *Session* permits it.** The front controller matches the path, checks
`valid_id()`, and type-checks the body — is `nom` a string, is a Duel count a
non-negative int. Everything after that is an operation on `lib/session.php`
(`set_nom`, `add_profile`, `declare_ready`, `record_verdict`, `replace_bracket`,
`record_final_duel`), each taking a Session and returning the new one, each
throwing its own `Conflict` or `NotFound` with the French sentence that explains
it. That split is why "a Verdict after the merge is refused" is three lines in
`tests/unit.php` rather than an HTTP round trip in `tests/api.php` — the rule
and its test both live away from the wire.

**Everything that must not lose a concurrent update happens inside the lock,
in PHP.** That is why the Final Profile's Duels are resolved server-side
(`POST /final/duels` sends winner and loser, not a tree) while the private
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
node of the tree per call, so a retry after a lost response would count the Duel
twice. `resolveFinalDuel` sends them one at a time, outside the Outbox, and says
so out loud when one is lost — a Duel silently played twice is worse than one
openly dropped.

**The Session cache is a module; `state.svelte.ts` is its shell.**
`session-cache.ts` holds every read and write of server state — when a write may
go out at all, the Bracket debounce, the Profile handover, the Final Profile
Duel chain — and reaches for no browser global: the state objects it mutates,
the API, the Outbox, the Profile memory and the timers all arrive through its
constructor. `state.svelte.ts` supplies the real ones, owns the `$state` (runes
only compile in a `.svelte.ts` file), `location`/`history`/`sessionStorage`, the
event listeners and the Deck. New behaviour almost always belongs in the cache,
where `session-cache.test.ts` can drive a whole Session against a fake API and
fake timers.

**Every cache operation names its Mode.** `setVerdict("female", …)`, not a
default read off `ui.mode` — the cache cannot see the UI, and a Verdict is keyed
by (Profile, Mode, Prénom), so the call is too.

**Nothing fetches on import.** `main.ts` calls `loadDecks()` and `initDecks()`
before mounting. A module that performs a network request merely by being
imported cannot be imported by a test, which is what used to put the entire
state layer out of reach of `node --test`.

**The Prénom List is data, not code.** `frontend/data/prenoms.csv` is imported
with `?url` and fetched at runtime, so Vite fingerprints it and Apache caches it
for a year. It is generated by `tools/build_prenoms.py` and hand-edited
afterwards; `tools/check_prenoms.py` guards its shape in CI.

## Adding a feature

1. Name it in [`CONTEXT.md`](../CONTEXT.md) if it introduces a concept.
2. If it changes what the server stores, or what a Session permits, change
   `lib/session.php` and add a case to `backend/tests/unit.php` — a new rule
   belongs in an operation there, not in a `handle()` closure. If it adds an
   endpoint, add it to `handle()`, to `backend/tests/api.php`, and to the table
   in [`backend/README.md`](../backend/README.md).
3. Add the wire call to `src/lib/api.ts`, the cache update to
   `src/lib/session-cache.ts` with a case in `src/lib/session-cache.test.ts`,
   the wiring to `src/lib/state.svelte.ts` only if it needs the browser, and the
   view last.
4. `just test`, then `just e2e`.
