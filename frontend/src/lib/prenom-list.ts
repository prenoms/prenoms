import csvUrl from "../../data/prenoms.csv?url";
import type { Mode, Prenom } from "./domain";

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

/** Every Prénom that exists, loaded once at boot. */
export const prenomList: Prenom[] = parsePrenomList(await (await fetch(csvUrl)).text()).sort(
  alphabetical,
);

/** The ordered set of Prénoms eligible for each Mode. Built once, kept in memory. */
export const decks: Record<Mode, Prenom[]> = {
  male: prenomList.filter((p) => p.sexProfile.male),
  female: prenomList.filter((p) => p.sexProfile.female),
};
