import { untrack } from "svelte";
import { MODES, type Mode, type Prenom, type Verdict } from "./domain";
import { adjust, medianRating, START_RATING } from "./duel";
import { decks } from "./prenom-list";

const STORAGE_KEY = "prenoms";

type ModeState = {
  /** Drives the stable Deck shuffle in Tinder. */
  seed: number;
  /** Keyed by the Prénom string — never a row index, the CSV is hand-edited. */
  verdicts: Record<string, Verdict>;
  /** Shortlist only. */
  ratings: Record<string, number>;
  /** Duels played per Prénom, for provisionality. */
  duels: Record<string, number>;
};

export type PersistedState = {
  version: 1;
  /** Optional, shared across Modes, never leaves the device. */
  nom: string | null;
  modes: Record<Mode, ModeState>;
};

function emptyModeState(): ModeState {
  return {
    seed: Math.floor(Math.random() * 2 ** 31),
    verdicts: {},
    ratings: {},
    duels: {},
  };
}

function emptyState(): PersistedState {
  return {
    version: 1,
    nom: null,
    modes: { male: emptyModeState(), female: emptyModeState() },
  };
}

/**
 * Brings whatever is in localStorage up to the current shape. Unknown Prénoms
 * (removed from the Prénom List between builds) are kept, not deleted — a later
 * rebuild may bring them back. Views ignore them by working from the Decks.
 */
function migrate(raw: unknown): PersistedState {
  if (typeof raw !== "object" || raw === null) return emptyState();
  const stored = raw as Partial<PersistedState>;
  const state = emptyState();
  if (typeof stored.nom === "string" && stored.nom !== "") state.nom = stored.nom;
  for (const mode of MODES) {
    const storedMode = stored.modes?.[mode];
    if (!storedMode) continue;
    const target = state.modes[mode];
    if (typeof storedMode.seed === "number") target.seed = storedMode.seed;
    if (storedMode.verdicts) target.verdicts = { ...storedMode.verdicts };
    if (storedMode.ratings) target.ratings = { ...storedMode.ratings };
    if (storedMode.duels) target.duels = { ...storedMode.duels };
  }
  return state;
}

function load(): PersistedState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return emptyState();
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

export const persisted = $state<PersistedState>(load());

$effect.root(() => {
  $effect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  });
});

/**
 * There is no backend and no sync (ADR 0001), so clearing site data is the one
 * way to lose everything. Export/import is the manual escape hatch: the same
 * versioned blob, handed to the user as a file, and read back through the same
 * migration path as localStorage.
 */
export function exportState(): string {
  return JSON.stringify(persisted, null, 2);
}

/** What a merge did, so the UI can say it out loud. */
export type ImportReport = { added: number; promoted: number };

/**
 * Merges a previously exported file into the current state — never replaces it.
 * The usual case is two people judging the same Prénom List on their own devices
 * and pooling the results to finalise the choice, so an import must not cost the
 * importer their own work.
 *
 * Only keeps travel. The merged Shortlist is the union of the two: a keep on
 * either side is a keep after the merge, so a Prénom one of you rejected still
 * shows up and gets argued about in the Duels. Incoming rejects are dropped —
 * they would only pre-judge Prénoms the importer has not seen yet.
 *
 * Ratings and Duel counts follow the same rule: yours stand where you had one,
 * and a Prénom arriving as a keep takes the partner's Rating, which seeds it
 * better than the median syncRatings would hand out.
 *
 * Throws on anything unrecognisable rather than quietly doing nothing — unlike
 * load(), where a corrupt key is better swallowed than fatal.
 */
export function importState(json: string): ImportReport {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null || !("modes" in raw)) {
    throw new Error("Fichier non reconnu.");
  }

  const incoming = migrate(raw);
  const report: ImportReport = { added: 0, promoted: 0 };

  if (persisted.nom === null) persisted.nom = incoming.nom;

  for (const mode of MODES) {
    const target = persisted.modes[mode];
    const source = incoming.modes[mode];
    for (const [prenom, verdict] of Object.entries(source.verdicts)) {
      // Their rejects carry no weight: one they turned down and you never saw
      // stays unjudged, so it still reaches your Deck and you rule on it yourself.
      if (verdict !== "keep") continue;

      const mine = target.verdicts[prenom];
      if (mine === "keep") continue;
      if (mine === undefined) report.added += 1;
      else report.promoted += 1;

      target.verdicts[prenom] = "keep";
      if (source.ratings[prenom] !== undefined) {
        target.ratings[prenom] = source.ratings[prenom];
        target.duels[prenom] = source.duels[prenom] ?? 0;
      }
    }
  }

  return report;
}

/** The three views, swapped by a $state variable and mirrored into the URL hash. */
export type View = "browse" | "swipe" | "game";

const VIEWS: readonly View[] = ["browse", "swipe", "game"];

function viewFromHash(): View {
  const candidate = location.hash.replace(/^#\/?/, "");
  return VIEWS.find((v) => v === candidate) ?? "browse";
}

/** Session-level UI state: not persisted, Mode is chosen on entry. */
export const session = $state<{ mode: Mode; view: View }>({
  mode: "female",
  view: viewFromHash(),
});

export function setMode(mode: Mode) {
  session.mode = mode;
}

export function setView(view: View) {
  session.view = view;
  location.hash = `#/${view}`;
}

addEventListener("hashchange", () => {
  session.view = viewFromHash();
});

if (location.hash === "") location.replace(`#/${session.view}`);

/** The Deck in play for the current Mode. */
export const deck = {
  get current(): Prenom[] {
    return decks[session.mode];
  },
};

/**
 * The Nom is shared across both Modes and never required. Blank means "none" —
 * stored as null rather than an empty string so the views have one thing to test.
 */
export function setNom(value: string) {
  persisted.nom = value.trim() === "" ? null : value;
}

export function verdictFor(prenom: string, mode: Mode = session.mode): Verdict | undefined {
  return persisted.modes[mode].verdicts[prenom];
}

/** Starring in Browse and swiping right in Tinder both land here. */
export function setVerdict(prenom: string, verdict: Verdict, mode: Mode = session.mode) {
  persisted.modes[mode].verdicts[prenom] = verdict;
}

export function clearVerdict(prenom: string, mode: Mode = session.mode) {
  delete persisted.modes[mode].verdicts[prenom];
}

/**
 * Keeps Ratings in step with the Shortlist: a Prénom that gains a keep Verdict
 * enters at the median of the current Ratings, one that loses it loses its
 * Rating outright. Nobody else's Rating is touched — we do not unwind history.
 *
 * Driven off the Verdicts rather than the Deck, so a Prénom that disappears from
 * the Prénom List between builds keeps its Rating instead of having it deleted.
 */
function syncRatings(mode: Mode) {
  const state = persisted.modes[mode];
  const kept = new Set(
    Object.keys(state.verdicts).filter((prenom) => state.verdicts[prenom] === "keep"),
  );

  untrack(() => {
    for (const prenom of Object.keys(state.ratings)) {
      if (!kept.has(prenom)) {
        delete state.ratings[prenom];
        delete state.duels[prenom];
      }
    }

    const entering = [...kept].filter((prenom) => state.ratings[prenom] === undefined);
    if (entering.length === 0) return;

    const median = medianRating(Object.values(state.ratings));
    for (const prenom of entering) {
      state.ratings[prenom] = median;
      state.duels[prenom] = 0;
    }
  });
}

$effect.root(() => {
  $effect(() => {
    for (const mode of MODES) syncRatings(mode);
  });
});

export function ratingOf(prenom: string, mode: Mode = session.mode): number {
  return persisted.modes[mode].ratings[prenom] ?? START_RATING;
}

export function duelsOf(prenom: string, mode: Mode = session.mode): number {
  return persisted.modes[mode].duels[prenom] ?? 0;
}

/** Resolves one Duel: both Ratings move, nothing is eliminated. */
export function resolveDuel(winner: string, loser: string, mode: Mode = session.mode) {
  const state = persisted.modes[mode];
  const adjusted = adjust(ratingOf(winner, mode), ratingOf(loser, mode));
  state.ratings[winner] = adjusted.winner;
  state.ratings[loser] = adjusted.loser;
  state.duels[winner] = duelsOf(winner, mode) + 1;
  state.duels[loser] = duelsOf(loser, mode) + 1;
}
