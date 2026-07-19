# Prénoms

A browser-only tool that helps expectant parents explore French first names and
narrow them down to a shortlist, using INSEE birth-registration data as the
factual backbone.

There is no account, no server and no database. Every judgement you make lives in
your browser's local storage and never leaves the device.

**Live:** https://prenoms.github.io/prenoms/

## What it does

You pick a **Mode** — masculine or feminine — which selects the **Deck** of
Prénoms in play. A Prénom can belong to both Decks; Camille is one name with two
Decks, not two names. Everything you do is scoped to the Mode you are in, so
rejecting Camille as feminine leaves Camille untouched as masculine.

Three views work on that Deck:

### Cartes — swipe through the Deck

One Prénom at a time, keep or reject. The order is shuffled once per Mode and
stays stable across reloads, so you always resume where you left off. The last
few judgements can be undone within the session.

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
  Prénom, so you can judge the full name aloud. Shared across both Modes, never
  sent anywhere.
- **Export / import** — download your judgements and ratings as JSON, or restore
  them on another device. This is the only backup; clearing site data destroys
  everything.
- **Two independent Shortlists**, one per Mode. There is never a combined one.

## The data

`data/prenoms.csv` is the single source of truth for what exists in the app —
about 3,200 rows of `firstname,male,female` and nothing else. It is generated
from INSEE's *fichier des prénoms* by `tools/build_prenoms.py`, which uses a
century of birth counts to decide which Prénoms are worth showing and how the
male/female flags are set, then throws the counts away. The app ships no
popularity data and has no charts — see
[ADR 0002](docs/adr/0002-ship-only-three-columns-from-insee.md).

Prénoms are stored unaccented, and spelling variants are not distinct names.
The file is meant to be hand-edited: regenerating it preserves any Prénom you
added that INSEE does not produce.

```bash
./tools/build_prenoms.py                      # download from insee.fr and rebuild
./tools/build_prenoms.py --input nat2023.zip  # use a local copy
./tools/check_prenoms.py                      # validate + sort in place
./tools/check_prenoms.py --check              # validate only (used in CI)
```

Both scripts are `uv` single-file scripts with no dependencies.

## Development

```bash
pnpm install
pnpm dev       # vite dev server
pnpm build     # static build into dist/
pnpm preview   # serve the build
pnpm check     # svelte-check
```

Svelte 5 (runes) + TypeScript + Vite, no runtime dependencies. Pushing to `main`
builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Further reading

- [`CONTEXT.md`](CONTEXT.md) — the domain language. Prénom, Deck, Verdict,
  Shortlist, Duel, Rating and the ambiguities they resolve. Read this before
  touching the code.
- [ADR 0001](docs/adr/0001-no-backend-static-hosting.md) — why there is no
  backend, and what that costs (no live matching between partners, no
  cross-user statistics).
- [ADR 0002](docs/adr/0002-ship-only-three-columns-from-insee.md) — why only
  three columns of INSEE data reach the browser.
