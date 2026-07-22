/**
 * The Bracket: a single-elimination tournament over one Shortlist, and the
 * place-offs that turn its winner into a Top 5. Pure functions over a plain,
 * serialisable state — the state module owns the value, this owns the rules.
 *
 * There is no score. A Prénom's standing is its Place on the podium, and the
 * only fact a Duel establishes is "this one beat that one", so that is the only
 * fact stored.
 *
 * Why it is finite, and why the second place is honest:
 *
 * The field is drawn into a tournament tree. Playing it out costs one Duel per
 * Prénom bar one and yields the winner. To find the *second*, the winner is
 * lifted out and only the Duels along its path are replayed — everything else
 * in the tree was decided by Duels the winner was never in, and stands. That is
 * one round of Duels per further Place, not another whole tournament, which is
 * what makes a Top 5 cost a few dozen Duels rather than a few hundred.
 *
 * The rest of the field is not ranked and is not pretended to be. A Prénom
 * knocked out in the first round by the eventual winner has been told nothing
 * about how it compares to one knocked out in the first round by anybody else.
 */

/** How many Places the podium holds. Beyond it, the field is unranked. */
export const TOP_PLACES = 5;

/**
 * A tournament in progress.
 *
 * `field` is the draw, fixed when the Bracket is drawn — Prénoms are indexed by
 * their position in it, which is why nothing may ever be spliced out of it.
 * `winners` is the tree, one slot per internal node, holding the index of the
 * Prénom that came through it or null while that Duel is unplayed. `gone` is
 * every Prénom no longer contending: awarded a Place, or withdrawn because it
 * lost its keep Verdict.
 */
export type BracketState = {
  field: string[];
  /** Leaves, padded to a power of two so the tree is a plain array heap. */
  size: number;
  winners: (number | null)[];
  gone: number[];
  places: string[];
  played: number;
};

/** One Duel: two Prénoms that have met in the tree. Order is not significant. */
export type Duel = readonly [string, string];

/** Where a node's Duel stands: a Prénom through, nobody left, or not yet played. */
type Holder = number | "empty" | "pending";

export function emptyBracket(): BracketState {
  return { field: [], size: 1, winners: [null], gone: [], places: [], played: 0 };
}

function powerOfTwoAtLeast(count: number): number {
  let size = 1;
  while (size < count) size *= 2;
  return size;
}

/**
 * Draws a fresh Bracket. The field is shuffled rather than left in Shortlist
 * order: the draw decides who meets whom, and an alphabetical draw would put
 * the two Prénoms someone happened to star first against each other in round
 * one for no reason at all.
 */
export function drawBracket(shortlist: readonly string[], random: () => number = Math.random): BracketState {
  const field = [...shortlist];
  for (let i = field.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [field[i], field[j]] = [field[j]!, field[i]!];
  }
  const size = powerOfTwoAtLeast(Math.max(1, field.length));
  return { field, size, winners: new Array(size).fill(null), gone: [], places: [], played: 0 };
}

export function copyBracket(bracket: BracketState): BracketState {
  return {
    field: [...bracket.field],
    size: bracket.size,
    winners: [...bracket.winners],
    gone: [...bracket.gone],
    places: [...bracket.places],
    played: bracket.played,
  };
}

/** How many Places this field can actually fill. A field of three has no fifth. */
export function placesWanted(bracket: BracketState): number {
  return Math.min(TOP_PLACES, bracket.field.length);
}

export function isDecided(bracket: BracketState): boolean {
  return bracket.places.length >= placesWanted(bracket);
}

/** Everything still in the running, in no order — the tree has not said one yet. */
export function unranked(bracket: BracketState): string[] {
  return bracket.field.filter((prenom) => !bracket.places.includes(prenom));
}

/**
 * Who came through `node`, if anyone has. A leaf holds its own Prénom until
 * that Prénom is gone; an internal node holds whatever its Duel decided, and a
 * node with only one live side needs no Duel at all — a bye is not a question
 * worth asking.
 */
function holderOf(bracket: BracketState, node: number): Holder {
  if (node >= bracket.size) {
    const index = node - bracket.size;
    if (index >= bracket.field.length || bracket.gone.includes(index)) return "empty";
    return index;
  }
  const decided = bracket.winners[node];
  if (decided !== null && decided !== undefined) return decided;
  const left = holderOf(bracket, node * 2);
  const right = holderOf(bracket, node * 2 + 1);
  if (left === "pending" || right === "pending") return "pending";
  if (left === "empty") return right;
  if (right === "empty") return left;
  return "pending";
}

/** Forgets every Duel one Prénom won on its way up. Called when it leaves the tree. */
function clearPath(bracket: BracketState, index: number): void {
  for (let node = (bracket.size + index) >> 1; node >= 1; node >>= 1) bracket.winners[node] = null;
}

/**
 * Awards every Place the tree is now able to award, and lifts each winner out
 * so the next round of place-offs can find the one behind it. Idempotent, and
 * called after everything that touches the state.
 */
function award(bracket: BracketState): void {
  while (bracket.places.length < placesWanted(bracket)) {
    const top = holderOf(bracket, 1);
    if (top === "pending" || top === "empty") return;
    bracket.places.push(bracket.field[top]!);
    bracket.gone.push(top);
    clearPath(bracket, top);
  }
}

/**
 * Every Duel the tree is waiting on, deepest first so a round is finished
 * before the next is started. There are many of them early on, which is what
 * lets two parents play at once without ever being handed the same question.
 */
export function pendingDuels(bracket: BracketState): Duel[] {
  // Awarding the last Place clears that winner's path, which leaves nodes the
  // tree could still decide and no reason on earth to ask about them.
  if (isDecided(bracket)) return [];
  const duels: Duel[] = [];
  for (let node = bracket.size - 1; node >= 1; node--) {
    if (bracket.winners[node] !== null && bracket.winners[node] !== undefined) continue;
    const left = holderOf(bracket, node * 2);
    const right = holderOf(bracket, node * 2 + 1);
    if (typeof left !== "number" || typeof right !== "number") continue;
    duels.push([bracket.field[left]!, bracket.field[right]!]);
  }
  return duels;
}

/**
 * The Duel owed on one slot — one slot per Profile, so two parents at two
 * screens are handed different questions. A slot past the end of the queue
 * falls back to the first: near the final there is only one Duel left, and
 * showing the second parent an empty screen would be worse than the occasional
 * race, which `resolveBracket` refuses cleanly.
 */
export function duelAt(bracket: BracketState, slot: number): Duel | null {
  const duels = pendingDuels(bracket);
  if (duels.length === 0) return null;
  return duels[slot] ?? duels[0]!;
}

/**
 * Resolves one Duel by the fact alone — which Prénom was preferred — rather
 * than by node, so a parent is always answering the question they were shown.
 * A Duel matching nothing the tree is waiting on is stale — the other parent got
 * there first, or the Shortlist moved — and is refused rather than guessed at.
 */
export function resolveBracket(
  bracket: BracketState,
  winner: string,
  loser: string,
): BracketState | null {
  if (isDecided(bracket)) return null;
  const next = copyBracket(bracket);
  for (let node = next.size - 1; node >= 1; node--) {
    if (next.winners[node] !== null && next.winners[node] !== undefined) continue;
    const left = holderOf(next, node * 2);
    const right = holderOf(next, node * 2 + 1);
    if (typeof left !== "number" || typeof right !== "number") continue;
    const pair = [next.field[left], next.field[right]];
    if (!pair.includes(winner) || !pair.includes(loser)) continue;
    next.winners[node] = next.field[left] === winner ? left : right;
    next.played += 1;
    award(next);
    return next;
  }
  return null;
}

/**
 * Withdraws from the tree every Prénom that has lost its keep Verdict. Its
 * opponents advance without a Duel, which is the right answer: a Prénom nobody
 * is keeping cannot be on the podium, and the Duels it already won were about
 * it, not about them.
 *
 * Newcomers are deliberately *not* added. The draw is what makes a Bracket a
 * Bracket, and quietly slipping a Prénom into a tournament already under way
 * would put it in a round it never played. `needsRedraw` reports them instead,
 * and the screen offers a fresh draw.
 *
 * Returns null when nothing changed, so hydrating a Profile that is already in
 * step does not queue a write back to the server.
 */
export function withdrawUnkept(
  bracket: BracketState,
  shortlist: readonly string[],
): BracketState | null {
  const kept = new Set(shortlist);
  const next = copyBracket(bracket);
  let changed = false;
  for (let index = 0; index < next.field.length; index++) {
    const prenom = next.field[index]!;
    if (kept.has(prenom)) continue;
    const held = next.places.includes(prenom);
    // Already withdrawn and holding nothing: there is nothing left to take.
    if (next.gone.includes(index) && !held) continue;
    if (!next.gone.includes(index)) next.gone.push(index);
    // A Prénom nobody is keeping cannot hold a Place. Everyone below moves up,
    // and `award` fills the gap this opens at the bottom of the podium.
    if (held) next.places = next.places.filter((p) => p !== prenom);
    clearPath(next, index);
    changed = true;
  }
  if (!changed) return null;
  award(next);
  return next;
}

/** Whether the Shortlist holds Prénoms this Bracket never drew. */
export function needsRedraw(bracket: BracketState, shortlist: readonly string[]): boolean {
  const drawn = new Set(bracket.field);
  return shortlist.some((prenom) => !drawn.has(prenom));
}

/**
 * How many Duels are still owed, at most. An upper bound rather than a promise:
 * byes and withdrawals cost nothing. It is honest to show because it only ever
 * falls.
 */
export function duelsLeft(bracket: BracketState): number {
  if (isDecided(bracket)) return 0;
  const rounds = Math.ceil(Math.log2(Math.max(2, bracket.size)));
  const live = bracket.field.length - bracket.gone.length;
  if (live <= 1) return 0;
  // Finishing the tournament in play, then one path replayed per further Place.
  const undecided = countUndecided(bracket);
  const furtherPlaces = Math.max(0, placesWanted(bracket) - bracket.places.length - 1);
  return undecided + furtherPlaces * rounds;
}

function countUndecided(bracket: BracketState): number {
  let count = 0;
  for (let node = 1; node < bracket.size; node++) {
    if (bracket.winners[node] !== null && bracket.winners[node] !== undefined) continue;
    if (holderOf(bracket, node) === "pending") count += 1;
  }
  return count;
}

/**
 * Which of the two goes on the left. Stable for a given Duel, so the cards do
 * not swap under a thumb already moving, but not always the same side of the
 * tree.
 */
export function duelOrder(duel: Duel): Duel {
  let hash = 0;
  for (const character of `${duel[0]}|${duel[1]}`) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return hash % 2 === 0 ? duel : [duel[1], duel[0]];
}
