/**
 * Elo over one Mode's Shortlist, and the logic that picks the next Duel.
 * Pure functions — the state module owns the numbers, this owns the maths.
 */

export const START_RATING = 1000;
const K = 32;

/** Below this many Duels a Prénom's Rating is not to be trusted yet. */
export const PROVISIONAL_DUELS = 5;

/** How many near-Rating Prénoms a Duel is drawn from, to avoid repeating pairs. */
const NEIGHBOURHOOD = 4;

export type Contender = { prenom: string; rating: number; duels: number };

export type Pair = readonly [string, string];

function expected(rating: number, against: number): number {
  return 1 / (1 + 10 ** ((against - rating) / 400));
}

/** Resolves one Duel. Nothing is eliminated — both Ratings simply move. */
export function adjust(winner: number, loser: number): { winner: number; loser: number } {
  const shift = K * (1 - expected(winner, loser));
  return { winner: winner + shift, loser: loser - shift };
}

/**
 * Where a Prénom newly added to the Shortlist enters: the median of the
 * existing Ratings, so it neither leapfrogs settled favourites nor starts buried.
 */
export function medianRating(ratings: readonly number[]): number {
  if (ratings.length === 0) return START_RATING;
  const sorted = ratings.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function isProvisional(contender: Contender): boolean {
  return contender.duels < PROVISIONAL_DUELS;
}

/**
 * Picks the next Duel: a provisional Prénom if there is one, so it settles
 * quickly, then the closest Ratings to it — a Duel between an obvious favourite
 * and an obvious also-ran tells us nothing. `avoid` keeps the same pair from
 * coming back twice in a row.
 */
export function choosePair(
  contenders: readonly Contender[],
  random: () => number = Math.random,
  avoid: Pair | null = null,
): Pair | null {
  if (contenders.length < 2) return null;

  const provisional = contenders.filter(isProvisional);
  const pool = provisional.length > 0 ? provisional : contenders;
  const first = pool[Math.floor(random() * pool.length)]!;

  let rest = contenders.filter((c) => c.prenom !== first.prenom);
  if (avoid?.includes(first.prenom) && rest.length > 1) {
    const excluded = avoid[0] === first.prenom ? avoid[1] : avoid[0];
    rest = rest.filter((c) => c.prenom !== excluded);
  }

  const nearest = rest
    .slice()
    .sort((a, b) => Math.abs(a.rating - first.rating) - Math.abs(b.rating - first.rating))
    .slice(0, NEIGHBOURHOOD);

  const second = nearest[Math.floor(random() * nearest.length)]!;
  return [first.prenom, second.prenom];
}
