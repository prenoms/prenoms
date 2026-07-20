# Prénoms

A tool that helps two expectant parents explore French first names and narrow them
down to a shortlist together, using INSEE birth-registration data as the factual
backbone. Each parent judges privately in their own Profile; the two are pooled
into a Final Profile once both are ready. See
[ADR 0003](docs/adr/0003-sessions-on-a-php-backend.md).

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
The family name optionally supplied, rendered after the Prénom so it can be judged
aloud. Never required. It belongs to the Session, not to a Profile — one family
name, shared by both parents and across both Modes, editable by either.
_Avoid_: Lastname, surname, family name

### Sharing

**Session**:
The shared workspace two parents judge inside, and the only place data lives. Named
by a short random id that is also its sole key — holding the link is holding the
Session. Contains exactly two Profiles, the Nom, and, once merged, the Final
Profile.
_Avoid_: Room, account, workspace, game

**Profile**:
One person within a Session. Owns their own Verdicts, Ratings and Duel counts, in
both Modes. Claimed by picking a name from the Session's Profile list — there is no
password, and the device remembers nothing between visits.
_Avoid_: User, player, account, partner

**Ready**:
A Profile's declaration that it has finished swiping. One switch covering both
Modes, and it cannot be undone. When every Profile in the Session is ready, the
Session merges.
_Avoid_: Done, finished, locked, submitted

**Final Profile**:
What a Session becomes at the merge: the union of every Prénom any Profile kept,
with all earlier Ratings discarded, duelled by both parents against one shared
Rating. There is one Final Profile per Session, holding one Shortlist per Mode.
_Avoid_: Result, merged profile, combined shortlist, winner

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
One Profile's judgement of one Prénom within one Mode — kept or rejected. Keyed by
(Profile, Mode, Prénom), so the same Prénom can be rejected as feminine and
untouched as masculine, and rejected by one parent while kept by the other. Never
visible to the other Profile before the merge.
_Avoid_: Vote, swipe, like, star, decision

**Shortlist**:
The Prénoms with a keep Verdict, in one Mode, for one Profile. One per (Profile,
Mode), never a combined one — the Final Profile's Shortlists are the only pooled
ones, and they are reached by merging, not by combining on the fly.
_Avoid_: Favourites, saved names, picks

### Ranking

**Duel**:
A single head-to-head between two Prénoms from the same Shortlist, resolved by
picking one. Nothing is eliminated. Before the merge a Duel is private to one
Profile; in the Final Profile both parents play into the same Ratings.
_Avoid_: Match, battle, round, vote

**Rating**:
A Prénom's strength within one Shortlist, adjusted after every Duel it takes part
in. Meaningful only relative to the other Prénoms in that same Shortlist — two
Profiles' Ratings are not comparable, which is why the merge discards them all and
starts the Final Profile level.
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
- **A Verdict belongs to a Profile, not to a Session.** Two people in one Session
  can disagree about the same Prénom in the same Mode, and both Verdicts stand.
  The merge does not resolve the disagreement, it forwards it to the Duels.
- **The merge is a union, not a match.** A Prénom one parent rejected still enters
  the Final Profile if the other kept it. Nothing is filtered out by disagreement —
  there is no such thing as a Prénom being "matched".
- **Ready is per Profile and covers both Modes.** There is no readiness for a
  single Mode: you finish masculine and feminine, or you are not ready.
- **The Final Profile is a Profile, not a report.** It has Shortlists, Ratings and
  Duels like any other, and it is the only one both parents write to.
- **A Prénom is identified by its string.** There are no numeric ids — the Prénom
  List is hand-edited, so row position is not stable and must never be an identity.
- **Starring and swiping right are one concept.** Both record a keep Verdict. The
  browse list and the swipe deck are two ways into the same judgement, not two
  separate collections.
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

---

> **Dev**: My partner kept Jeanne and I rejected it. After the merge, is Jeanne in?
>
> **Domain expert**: In. The Final Profile is the union — everything either of you
> kept. Your rejection didn't delete it, it just meant you weren't the one bringing
> it. Now you argue about it in the Duels.
>
> **Dev**: Then what did my rejections achieve?
>
> **Domain expert**: They kept your own Shortlist clean while you were building it,
> and they mean you never had to rank a name you didn't like. A rejection is a
> statement about your list, not a veto over theirs.
>
> **Dev**: And my Ratings carry over into the final Duels?
>
> **Domain expert**: No. Everything starts level. Your 1600 was earned against your
> names and theirs against theirs — the numbers don't mean the same thing, so
> putting them in one table would be inventing a comparison that was never played.
>
> **Dev**: Can I see how far they've got before I hit ready?
>
> **Domain expert**: You can see whether they're ready. Nothing else — not their
> keeps, not their count. If you could see their Shortlist while you were still
> swiping, you'd start agreeing with it, and then the Duels would be theatre.
