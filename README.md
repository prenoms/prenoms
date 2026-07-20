# Prénoms

A tool that helps two expectant parents explore French first names and narrow
them down to a shortlist together, using INSEE birth-registration data as the
factual backbone.

Each parent judges privately in their own **Profile** inside a shared
**Session**; when both declare themselves **ready**, the two Shortlists merge
into a **Final Profile** they rank together. There are no accounts and no
passwords — the Session link is the only key, and holding it is the whole
authorisation story. See
[ADR 0003](docs/adr/0003-sessions-on-a-php-backend.md).

**Live:** https://quelprenom.xyz

## What it does

You pick a **Mode** — masculine or feminine — which selects the **Deck** of
Prénoms in play. A Prénom can belong to both Decks; Camille is one name with two
Decks, not two names. Everything you do is scoped to the Mode you are in, so
rejecting Camille as feminine leaves Camille untouched as masculine.

Three views work on that Deck:

### Cartes — swipe through the Deck

One Prénom at a time, keep or reject. The order is shuffled once per Mode and
stays stable across reloads, so you always resume where you left off. The last
few judgements can be undone until you leave the page.

### Parcourir — search and star

The whole Deck as a searchable list, with accent- and case-insensitive fuzzy
matching (typing `zoe` finds Zoé). Star a Prénom to keep it; un-star to clear the
judgement entirely, which returns it to the swipe Deck unjudged. The list can be
scoped to the Deck or to your Shortlist alone.

### Duels — rank your shortlist

Head-to-head matches between two Prénoms from your Shortlist. Nothing is ever
eliminated: each pick adjusts an Elo Rating, and the Ranking sharpens the more
Duels you play. Pairs are drawn from Prénoms of similar Rating so the matchups
stay meaningful, and names with too few Duels are flagged *à confirmer* rather
than trusted.

### Everything else

- **Nom (optional)** — supply a family name and it is rendered after every
  Prénom, so you can judge the full name aloud. It belongs to the Session, so it
  is shared across both Modes and both Profiles, and either parent may set it.
- **Nothing is stored on your device.** No local storage, no export file to
  remember to make. The Session lives on the server and the link reaches it from
  any device — which also means losing the link loses the Session for good.
- **Your partner's Verdicts stay hidden** until the merge. You can see whether
  they are ready and nothing else; seeing their Shortlist while you were still
  swiping would make the final Duels theatre.
- **The merge is a union, not a match.** A Prénom your partner kept is in the
  Final Profile even if you rejected it — a rejection is a statement about your
  own list, not a veto over theirs. All earlier Ratings are discarded and
  everything starts level, because a Rating only means something against the
  Shortlist it was earned in.
- **Two independent Shortlists**, one per Mode. There is never a combined one.

## The data

`frontend/data/prenoms.csv` is the single source of truth for what exists in the
app — about 3,200 rows of `firstname,male,female` and nothing else. It is
generated from INSEE's *fichier des prénoms* by `tools/build_prenoms.py`, which
uses a century of birth counts to decide which Prénoms are worth showing and how
the male/female flags are set, then throws the counts away. The app ships no
popularity data and has no charts — see
[ADR 0002](docs/adr/0002-ship-only-three-columns-from-insee.md).

Prénoms are stored unaccented, and spelling variants are not distinct names.
The file is meant to be hand-edited: regenerating it preserves any Prénom you
added that INSEE does not produce.

```bash
just build-data                         # download from insee.fr and rebuild
just build-data --input nat2023.zip     # use a local copy
./tools/check_prenoms.py                # validate + sort in place
just check-data                         # validate only (used in CI)
```

Both scripts are `uv` single-file scripts with no dependencies.

## Layout

```
frontend/     Svelte 5 (runes) + TypeScript + Vite, no runtime dependencies
backend/      the Session API: plain PHP 8.1, no framework, no Composer, no DB
e2e/          the staged tree, served the way Apache will serve it
tools/        the Prénom List builders, plus stage.sh and deploy.sh
docs/         architecture, testing, deployment, and the ADRs
justfile      every workflow: run, test, build, deploy
root.htaccess deployed as www/.htaccess — /api → PHP, everything else → the app
ovhconfig     deployed as .ovhconfig — pins the PHP version
```

## Development

Requires PHP 8.1+, Node 24+, pnpm, [just](https://just.systems), and `uv` for
the data scripts (`lftp` too, if you deploy).

```bash
just                    # list every recipe
just run-frontend-local # vite on 127.0.0.1:5173, proxying /api to the PHP below
just run-backend-local  # php -S on 127.0.0.1:8888, Sessions in ./.prenoms-data
just test               # frontend + backend + data, and the build
just e2e                # the deployed shape, end to end
```

The API is documented endpoint by endpoint in
[`backend/README.md`](backend/README.md); how the halves fit together is
[docs/architecture.md](docs/architecture.md), and what each test layer is for is
[docs/testing.md](docs/testing.md).

## Deployment

Apache + PHP 8 on OVH shared hosting, no database and no cron. `just deploy`
runs the checks, builds, stages exactly what the web root should contain and
mirrors it over FTPS. It is run by hand — the FTP credentials reach every
Session on the host, so they stay off CI.

```bash
just init-env         # .env from the example, then fill in the OVH credentials
just deploy --dry-run # show what would change
just deploy
just smoke-prod       # assert the live site works
```

The remote layout, why the data directory sits outside the web root, and what
never ships: [docs/deployment.md](docs/deployment.md).

## Further reading

- [`CONTEXT.md`](CONTEXT.md) — the domain language. Prénom, Deck, Verdict,
  Shortlist, Duel, Rating and the ambiguities they resolve. Read this before
  touching the code.
- [`CLAUDE.md`](CLAUDE.md) — the hard constraints and conventions, in short.
- [ADR 0001](docs/adr/0001-no-backend-static-hosting.md) — superseded: why
  there was no backend, and what that cost.
- [ADR 0002](docs/adr/0002-ship-only-three-columns-from-insee.md) — why only
  three columns of INSEE data reach the browser.
- [ADR 0003](docs/adr/0003-sessions-on-a-php-backend.md) — why Sessions moved to
  a server, why the link is the only key, and why the merge re-duels from zero.
