# Ship only `firstname,male,female` from the INSEE data

INSEE's fichier des prénoms carries a century of birth counts broken down by year,
sex and département, and the app is seeded from it — but the only thing that reaches
the browser is a flat CSV of three columns. Popularity is used at build time to
decide which Prénoms are worth showing and how the male/female flags are set, then
discarded. The product is a reaction to how a name *sounds*, not a demographic
explorer, and a card that shows nothing but the Prénom (optionally followed by the
user's Nom) is the whole experience.

## Consequences

- **No curves, no maps, no rankings.** There is no detail view to build and no
  large data payload to ship or shard. `frontend/data/prenoms.csv` is a few thousand rows.
- **INSEE is a seed, not a backbone.** The generated list is deliberately editable:
  `tools/build_prenoms.py` preserves any Prénom present in the CSV that INSEE does
  not produce, so hand-added names survive regeneration.
- **The interesting parameters are build-time constants**, not runtime filters —
  the trailing window, the minimum birth count, and the share of births needed for
  a sex flag. Changing them means regenerating and committing the CSV.
- Reintroducing popularity later means reintroducing the whole two-tier data
  pipeline that this decision removes.

## Accents are stripped

INSEE records every spelling separately — `Zoé`, `Zoe`, `Zoë`; `Maël`, `Mael`;
`Inès`, `Ines`, `Inés`, `Inês` — which put ~2000 near-duplicate cards in the deck.
We fold them together and write the unaccented form, which also disposes of the
registry's encoding artefacts (`Émma`, 155 births against Emma's 126,415).

This is a real trade-off and we took the shorter list: `Maël` and `Mael` are
arguably a genuine choice a parent makes (46,295 vs 26,595 births), and cards now
read `Zoe` and `Chloe`, which look misspelled to a French eye. The alternative —
merge the variants but display the most common spelling — remains a one-function
change in `tools/build_prenoms.py`.

**It is not freely reversible.** A Prénom is identified by its string, so restoring
accents renames every Prénom and orphans every Verdict and Rating already stored in
a user's browser.

