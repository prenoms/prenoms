/**
 * A French syllable counter, ~40 lines, deliberately not a dependency.
 *
 * It is a heuristic and it is sometimes wrong: Louis comes out at 2 where a
 * speaker says 1, Jules at 2 where a final silent `es` says 1, and any name
 * whose pronunciation depends on its origin (Mohamed-Ali, Fatima-Zahra) is
 * guesswork. A silent final `es` is left alone on purpose — the List holds
 * twice as many Prénoms that pronounce it (Ines, Agnes, Younes, Fares) as
 * swallow it (Jules, Charles, Gilles). That is acceptable because the
 * count is never shown — it only feeds the Filter, where being one off moves a
 * Prénom between two neighbouring buckets and nothing more. Do not display it.
 *
 * The rule is: one syllable per vowel nucleus. A nucleus is either a known
 * French vowel group (`eau`, `ou`, `ai`, …) or a single vowel. Everything not
 * in the list splits — Leo, Mia and Lea are two, not one.
 */

import { fold } from "./fuzzy";

const VOWELS = "aeiouy";

/** Vowel groups pronounced as one nucleus, longest first so `eau` beats `eu`. */
const NUCLEI = [
  "eau",
  "oeu",
  "eu",
  "au",
  "ou",
  "oi",
  "ai",
  "ei",
  "ay",
  "oy",
  "ey",
  "uy",
  "ui",
  "ie",
  // A doubled vowel is written twice and said once: Aaron, Isaac, Aimee.
  "aa",
  "ee",
  "ii",
  "oo",
  "uu",
];

/** True where a nucleus from the list has to be broken back into two vowels. */
function splitsAnyway(text: string, i: number, nucleus: string): boolean {
  // `-iel` is two (Ga-bri-el, Da-ni-el) where every other `ie` is one
  // (Ma-rie, Ju-lien, O-li-vier).
  return nucleus === "ie" && text[i + 2] === "l";
}

function isVowel(c: string | undefined): boolean {
  return c !== undefined && VOWELS.includes(c);
}

/** Counts the nuclei of one hyphen-free part, already folded. */
function countPart(part: string): number {
  // A final lone `e` is silent after a consonant (Jeanne, Alice), but not after
  // a vowel — accents are stripped from the Prénom List, so Zoe and Chloe would
  // otherwise lose the syllable their accent used to carry.
  // The u of `qu` carries no sound of its own (Dominique, Angelique). Folding
  // it into a consonant first keeps it out of the nucleus scan, and out of the
  // silent-e test below.
  let text = part.replaceAll("qu", "k");
  if (text.length > 1 && text.endsWith("e") && !isVowel(text[text.length - 2])) {
    text = text.slice(0, -1);
  }

  let count = 0;
  for (let i = 0; i < text.length; ) {
    if (!isVowel(text[i])) {
      i++;
      continue;
    }

    // `ea` is one nucleus only when nasalised by a following n or m (Jean);
    // elsewhere it splits (Lea).
    if (text.startsWith("ea", i) && (text[i + 2] === "n" || text[i + 2] === "m")) {
      count++;
      i += 2;
      continue;
    }

    const nucleus = NUCLEI.find((n) => text.startsWith(n, i) && !splitsAnyway(text, i, n));
    count++;
    i += nucleus?.length ?? 1;
  }

  return Math.max(count, 1);
}

/** How many syllables a Prénom has. Each part of a composed Prénom counts. */
export function countSyllables(prenom: string): number {
  return fold(prenom)
    .split("-")
    .filter((part) => part !== "")
    .reduce((total, part) => total + countPart(part), 0);
}
