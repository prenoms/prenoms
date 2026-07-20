/** The two Modes a user can be in. A Mode selects which Deck is in play. */
export type Mode = "male" | "female";

export const MODES: readonly Mode[] = ["male", "female"];

/**
 * Which Decks a Prénom belongs to. An attribute of a Prénom, never part of its
 * identity — masculine and feminine Camille are one Prénom.
 */
export type SexProfile = { male: boolean; female: boolean };

/** A single canonical French first name, identified by its (unaccented) string. */
export type Prenom = {
  prenom: string;
  sexProfile: SexProfile;
};

/** A user's judgement of one Prénom within one Mode. */
export type Verdict = "keep" | "reject";
