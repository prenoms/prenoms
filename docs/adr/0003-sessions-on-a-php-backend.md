# Sessions live on a server, and the link is the only key

Supersedes [ADR 0001](0001-no-backend-static-hosting.md).

Local storage turned out to be too easy to lose. A cleared cache, a private
window, a new phone — and months of Verdicts were gone, with export/import as the
only defence, which is a defence nobody remembers to use before they need it. So
the judgements move off the device.

A **Session** is the unit that moves. It is named by a short random id, holds
exactly two **Profiles**, and stores everything that used to live in
localStorage: each Profile's Verdicts, Ratings and Duel counts for both Modes,
plus the Session's Nom. The id is the whole access-control story — anyone holding
it can join the Session, claim either Profile and act as them. There are no
accounts, no passwords and no email, because the only two people who ever see the
link are the two people who share the Session, and impersonation between them is
not a threat we are asked to solve.

The id is ten characters of Crockford base32 from a CSPRNG: about fifty bits,
which no one is going to enumerate against a hobby host, while staying short
enough to read aloud over the phone and to carry in a path — `/s/K7M2QX9RTB`.

## The client stores nothing

Not the Session list, not which Profile you are. The homepage always asks whether
you are joining or creating; following a link always asks which of the two
Profiles you are. This is deliberate: a device that remembers nothing is a device
that can lose nothing, and it makes the shared-tablet case — two people taking
turns on one screen — work without a switcher.

Swipes apply in memory immediately and are written through per Verdict, keyed by
`(profile, mode, prénom)` so a retry is free. There is no offline queue, because
a queue would have to be persisted and persistence is the thing we removed. A
connection that stays broken until the tab closes loses the swipes made in the
meantime, and the UI has to say so rather than fail quietly.

## Consequences

- **The link is the only key.** Lose it and the Session is unreachable for good;
  an unguessable id and no account leave no recovery path. The moment a Session is
  created is therefore the moment the app must push hardest — copy the link, send
  it to your partner, add it to your home screen.
- **Live matching is now possible**, which ADR 0001 gave up. We have not taken it:
  a Profile can see whether the other is ready and nothing else — never their
  Verdicts, never their progress. Swiping stays uncontaminated, which is what makes
  the final Duels honest.
- **Export/import is deleted**, along with `Backup.svelte`. Old localStorage is
  ignored and its key cleared on first load; nothing is migrated.
- **We now hold people's data.** Names, the family Nom, and a record of judgements
  about them. Sessions untouched for twelve months are unlinked, swept
  probabilistically on write since the host has no cron.
- **Hosting moves to OVH** — free, Apache, PHP 8, no database. One JSON file per
  Session outside the web root, `flock(LOCK_EX)` around every read-modify-write.
  Deployment becomes an FTP push of `dist/` instead of GitHub Pages.
- **The Session id is user input that becomes a filename.** It is validated against
  a strict alphabet before it goes anywhere near a path.

## The endgame is a union, re-duelled from zero

Each Profile builds its own Shortlist and its own Ranking in private. When a
Profile declares itself **ready** — one switch covering both Modes, and it cannot
be undone — and every Profile in the Session is ready, the Session merges into a
**Final Profile**.

The merge is a **union**: every Prénom either person kept, including the ones the
other rejected. This is the rule the old import already used, and the reasoning is
unchanged — a name your partner loves is not disposed of by your swipe, it is
argued about. The Duels are where that argument happens.

All per-Profile Ratings are discarded at the merge and every Prénom in the Final
Profile starts equal. Averaging the two Rankings was tempting and is unsound: a
Rating is meaningful only against the Shortlist it was earned in, so your 1520 and
your partner's 1520 are not the same number, and a name only one of you kept has a
Rating from one side only. The per-Profile Duels were never wasted — they are how
each of you decided what to bring.

Both partners then duel one shared Rating, so Elo is computed **by the server**,
inside the lock, from a `{winner, loser}` fact. A client-side computation would
drop a Duel whenever both people picked at the same moment. The cost is that the
Elo math exists twice; we contain it by making PHP the sole owner of Final Profile
Ratings and `src/lib/duel.ts` the sole owner of the per-Profile phase.

## Ready is irreversible, and that is the sharp edge

Once merged, a Session never goes back to swiping. It keeps the state machine
small and the Final Ranking stable, and it means the whole design has exactly one
destructive action. Two things blunt it: the other Profile's ready state is
visible, so nobody confirms blind, and the confirmation says plainly what it ends.

A Session with one Profile merges as soon as that Profile is ready — the union of
one set is itself — so the app works alone. The same rule is what lets you end
your partner's swiping before they have joined, which is why the confirmation
names how many Profiles are in the Session.
