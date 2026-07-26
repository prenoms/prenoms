/**
 * The Filter: the criteria of form that decide what Parcourir shows.
 *
 * It hides, it does not judge. Nothing here touches a Deck or a Verdict — a
 * Prénom the Filter hides is still in the Cartes, still keeps whatever Verdict
 * it had, and still counts in "Deck 1712". Only the tally follows the Filter.
 */

import type { Prenom } from "./domain";
import { countSyllables } from "./syllables";

/** A bound of `null` is no bound at all, not the Deck's own minimum. */
export type Range = { min: number | null; max: number | null };

export type PrenomFilter = {
  letters: Range;
  syllables: Range;
  /** Both default to true: the Filter starts showing everything. */
  showComposed: boolean;
  showMixed: boolean;
};

/** What a Prénom needs to carry to be filtered — the counts, measured once. */
export type Measured = Prenom & { letters: number; syllables: number };

/** A fresh Filter that lets everything through. A function, not a constant, so
 * nobody resets one Filter by handing out a shared object. */
export function defaultFilter(): PrenomFilter {
  return {
    letters: { min: null, max: null },
    syllables: { min: null, max: null },
    showComposed: true,
    showMixed: true,
  };
}

/** A Prénom written in two parts joined by a hyphen — Jean-Baptiste. */
export function isComposed(prenom: string): boolean {
  return prenom.includes("-");
}

/** A Prénom whose Sex Profile carries both sexes, so it is in both Decks. */
export function isMixed(p: Prenom): boolean {
  return p.sexProfile.male && p.sexProfile.female;
}

/** Letters as the eye counts them on screen, hyphen included: Jean-Baptiste is 13. */
export function measure(p: Prenom): Measured {
  return { ...p, letters: p.prenom.length, syllables: countSyllables(p.prenom) };
}

function within(value: number, range: Range): boolean {
  return (range.min === null || value >= range.min) && (range.max === null || value <= range.max);
}

export function matches(p: Measured, filter: PrenomFilter): boolean {
  if (!within(p.letters, filter.letters)) return false;
  if (!within(p.syllables, filter.syllables)) return false;
  if (!filter.showComposed && isComposed(p.prenom)) return false;
  if (!filter.showMixed && isMixed(p)) return false;
  return true;
}

/** How many criteria are set, for the badge on the Filtrer button. */
export function activeCount(filter: PrenomFilter): number {
  let count = 0;
  if (filter.letters.min !== null || filter.letters.max !== null) count++;
  if (filter.syllables.min !== null || filter.syllables.max !== null) count++;
  if (!filter.showComposed) count++;
  if (!filter.showMixed) count++;
  return count;
}

/**
 * The ends of the sliders, measured on the Deck in play rather than fixed as
 * constants — the Prénom List is hand-edited, and a Prénom longer than any
 * constant we wrote down would be silently unreachable.
 */
export type Span = { min: number; max: number };

export function bounds(measured: readonly Measured[]): { letters: Span; syllables: Span } {
  const span = (values: number[]): Span =>
    values.length === 0
      ? { min: 1, max: 1 }
      : { min: Math.min(...values), max: Math.max(...values) };

  return {
    letters: span(measured.map((p) => p.letters)),
    syllables: span(measured.map((p) => p.syllables)),
  };
}
