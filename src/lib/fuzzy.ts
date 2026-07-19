/**
 * A subsequence matcher, ~40 lines, deliberately not a dependency.
 *
 * Prénoms are unaccented ASCII, so matching is a plain in-order subsequence
 * scan: every query character must appear in the Prénom, in order. The score
 * rewards matches that run consecutively and matches that land on a boundary —
 * the start of the Prénom, or just after a hyphen (Jean-Baptiste).
 */

const CONSECUTIVE_BONUS = 6;
const BOUNDARY_BONUS = 10;
const LEADING_GAP_PENALTY = 1;

/** Lets a user type "Zoé" and find the Prénom we store as "Zoe". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isBoundary(target: string, index: number): boolean {
  if (index === 0) return true;
  const previous = target[index - 1];
  return previous === "-" || previous === " " || previous === "'";
}

/**
 * Scores `query` against `target`, both already folded. Higher is better;
 * `null` means no match at all. Only comparable within one search.
 */
export function score(query: string, target: string): number | null {
  if (query === "") return 0;

  let total = 0;
  let queryIndex = 0;
  let previousMatch = -1;

  for (let i = 0; i < target.length && queryIndex < query.length; i++) {
    if (target[i] !== query[queryIndex]) continue;

    total += 1;
    if (i === previousMatch + 1) total += CONSECUTIVE_BONUS;
    if (isBoundary(target, i)) total += BOUNDARY_BONUS;
    if (previousMatch === -1) total -= i * LEADING_GAP_PENALTY;

    previousMatch = i;
    queryIndex++;
  }

  return queryIndex === query.length ? total : null;
}
