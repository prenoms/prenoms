# Prénoms

A browser-only tool that helps expectant parents explore French first names and
narrow them down to a shortlist, using INSEE birth-registration data as the
factual backbone.

## Language

### The names themselves

**Prénom**:
A single canonical French first name, the unit a user sees, judges and collects.
One Prénom regardless of how many sexes it is given to.
_Avoid_: Name, firstname, given name

**Sex Profile**:
Which Decks a Prénom belongs to — masculine, feminine, or both. Two booleans, an
attribute of a Prénom, never part of its identity. Derived from birth counts when
the list is built; the counts themselves are not shipped.
_Avoid_: Gender, sex (unqualified)

**Prénom List**:
The `data/prenoms.csv` file — firstname, male, female. The single source of truth
for what exists in the app. Generated from INSEE, then extended by hand.
_Avoid_: Database, dataset, dictionary

**Rare Bucket**:
INSEE's catch-all row for names given too few times to publish individually. It is
not a Prénom and never becomes a card.
_Avoid_: `_PRENOMS_RARES` (in prose)

**Nom**:
The family name the user optionally supplies, rendered after the Prénom so they can
judge the full name aloud. Never required, shared across both Modes, never leaves
the device.
_Avoid_: Lastname, surname, family name

### Choosing

**Mode**:
Whether the user is currently looking for a masculine or a feminine name. Chosen on
entry, switchable at any time, and it selects which Deck is in play.
_Avoid_: Gender filter, sex filter, toggle

**Deck**:
The ordered set of Prénoms eligible for the current Mode. A Prénom may belong to
both Decks.
_Avoid_: List, pool, catalogue

**Verdict**:
A user's judgement of one Prénom within one Mode — kept or rejected. Keyed by
(Mode, Prénom), so the same Prénom can be rejected as feminine and untouched as
masculine.
_Avoid_: Vote, swipe, like, decision

**Shortlist**:
The Prénoms with a keep Verdict in a given Mode. There is one Shortlist per Mode,
never a combined one.
_Avoid_: Favourites, saved names, picks

### Ranking

**Duel**:
A single head-to-head between two Prénoms from the same Shortlist, resolved by the
user picking one. Nothing is eliminated.
_Avoid_: Match, battle, round, vote

**Rating**:
A Prénom's strength within one Mode's Shortlist, adjusted after every Duel it takes
part in. Meaningful only relative to the other Prénoms in that Shortlist.
_Avoid_: Score, elo, points

**Ranking**:
The Shortlist ordered by Rating. Readable at any time, sharper the more Duels have
been played, never final.
_Avoid_: Leaderboard, results, standings

## Flagged ambiguities

- **"Name" is banned on its own.** It collides with the raw INSEE string, the
  display form, and the domain concept. Say **Prénom** for the concept.
- **A Prénom is not identified by sex.** The INSEE file keys rows by
  `(sexe, preusuel, ...)`, so masculine and feminine Camille are separate rows.
  They are one Prénom with a Sex Profile — the split lives in the data, not in
  the identity.
- **Verdicts are per Mode, not per Prénom.** Rejecting a Prénom in one Mode says
  nothing about the other.
- **A Prénom is identified by its string.** There are no numeric ids — the Prénom
  List is hand-edited, so row position is not stable and must never be an identity.
- **Prénoms are unaccented.** INSEE treats Zoé, Zoe and Zoë as three names; we treat
  them as one, written without accents. Spelling variants are not distinct Prénoms.

## Example dialogue

> **Dev**: If someone rejects Camille, is Camille gone?
>
> **Domain expert**: Gone from that Deck. If they were looking at feminine names,
> Camille is out of the feminine Shortlist. Switch to masculine and Camille is
> back, untouched — it's a different Verdict.
>
> **Dev**: So Camille is two Prénoms?
>
> **Domain expert**: No, one Prénom. It just has a Sex Profile that puts it in
> both Decks. Two Verdicts, one Prénom.
>
> **Dev**: And a name that's 99% feminine — is it in the masculine Deck?
>
> **Domain expert**: No. Deck membership needs a real share of recent births, not
> a handful of records. Below that, it's noise.
