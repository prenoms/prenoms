import csvUrl from "../../data/prenoms.csv?url";
import type { Mode, Prenom } from "./domain";

/**
 * The Prénom List: parsed, sorted, and split into the two Decks. Loading it is
 * a function rather than a top-level `await`, because a module that fetches on
 * import cannot be imported by anything that does not want a network — which
 * used to mean the state layer could not be reached from `node --test` at all.
 * `main.ts` calls `loadDecks()` once, before mounting.
 */

/**
 * Parses the Prénom List: three columns, no quoting, no embedded commas.
 * Anything malformed is skipped rather than crashing the app — the file is
 * hand-editable and CI (`check_prenoms.py`) is what guards its shape.
 */
export function parsePrenomList(csv: string): Prenom[] {
  const prenoms: Prenom[] = [];
  const lines = csv.split("\n");
  for (const line of lines.slice(1)) {
    const row = line.trim();
    if (row === "") continue;
    const [prenom, male, female] = row.split(",");
    if (prenom === undefined || male === undefined || female === undefined) continue;
    prenoms.push({ prenom, sexProfile: { male: male === "true", female: female === "true" } });
  }
  return prenoms;
}

const alphabetical = (a: Prenom, b: Prenom) => a.prenom.localeCompare(b.prenom, "fr");

/** The ordered set of Prénoms eligible for each Mode. A Prénom may be in both. */
export function buildDecks(prenomList: readonly Prenom[]): Record<Mode, Prenom[]> {
  const sorted = prenomList.slice().sort(alphabetical);
  return {
    male: sorted.filter((p) => p.sexProfile.male),
    female: sorted.filter((p) => p.sexProfile.female),
  };
}

/** Fetches the Prénom List and builds both Decks. Called once, at boot. */
export async function loadDecks(): Promise<Record<Mode, Prenom[]>> {
  return buildDecks(parsePrenomList(await (await fetch(csvUrl)).text()));
}
