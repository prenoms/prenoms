import { untrack } from "svelte";
import { MODES, type Mode, type Prenom, type Verdict } from "./domain";
import { adjust, medianRating, START_RATING } from "./duel";
import { decks } from "./prenom-list";
import { Outbox } from "./outbox";
import {
  ID_PATTERN,
  normaliseId,
  deleteVerdict,
  fetchProfile,
  fetchSession,
  putNom,
  putRatings,
  putVerdict,
  type FinalState,
  type ModeState,
  type ProfileSummary,
} from "./api";

/**
 * The state layer. `$state` still backs the views, but it is a **cache of
 * server state** now, not a mirror of localStorage: the Session lives on the
 * server and the client persists nothing (ADR 0003).
 *
 * Writes are optimistic. A swipe lands in memory immediately and the request
 * goes out behind it through the `Outbox`, retried with backoff. When the
 * connection stays broken the banner says so — there is no offline queue,
 * because a queue would have to be persisted.
 */

/**
 * The one thing left in browser storage, cleared on first load. Nothing is
 * migrated — the old Verdicts are gone by design (ADR 0003). Wrapped because a
 * browser that refuses storage must not take the whole app down over a cleanup.
 */
try {
  localStorage.removeItem("prenoms");
} catch {
  // Nothing to clear, and nothing we could do about it.
}

function emptyModeState(): ModeState {
  return { seed: 0, verdicts: {}, ratings: {}, duels: {} };
}

/** The Session as anyone holding the link may see it. Never another Profile's Verdicts. */
export const session = $state<{
  id: string | null;
  nom: string | null;
  merged: boolean;
  profiles: ProfileSummary[];
  final: FinalState | null;
}>({ id: null, nom: null, merged: false, profiles: [], final: null });

/** The Profile you are acting as: your own Verdicts, Ratings and Duel counts. */
export const profile = $state<{
  id: string | null;
  name: string;
  ready: boolean;
  modes: Record<Mode, ModeState>;
}>({
  id: null,
  name: "",
  ready: false,
  modes: { male: emptyModeState(), female: emptyModeState() },
});

/**
 * How far the cache has got. The views read the Deck straight away, so an
 * unloaded Profile would silently look like one that has judged nothing —
 * hence a phase the shell can wait on rather than a bare boolean.
 */
export const status = $state<{ phase: "idle" | "loading" | "ready" | "error"; message: string | null }>(
  { phase: "idle", message: null },
);

/**
 * What the banner reads. `failing` is persistent by design: it stays up for as
 * long as writes are being retried, because closing the tab in that state loses
 * them for good and the UI has to say so rather than fail quietly.
 */
export const connection = $state<{ failing: boolean; refused: string | null }>({
  failing: false,
  refused: null,
});

const outbox = new Outbox();
outbox.onChange(() => {
  connection.failing = outbox.failing;
});
outbox.onError((error) => {
  // A refusal, not a lost swipe: the Session merged, or this Profile is ready.
  // These are terminal for the whole Session rather than for one write — the
  // optimistic cache is now showing Verdicts the server will never accept — so
  // the message stays up. Dismissing it would teach the user to swipe on into
  // a screen that has stopped meaning anything.
  connection.refused = error.message;
});

/* ------------------------------------------------------------------ loading */

/**
 * Fills the cache for one Profile inside one Session. Two requests, because the
 * Session view deliberately withholds Verdicts — your own state only ever comes
 * from the Profile endpoint, addressed by its id.
 */
export async function enterSession(sessionId: string, profileId: string): Promise<void> {
  // Whatever the outgoing Profile still owes goes out addressed to them, before
  // the cache becomes somebody else's — the shared-tablet handover.
  flushRatings();
  status.phase = "loading";
  status.message = null;
  connection.refused = null;
  try {
    const id = normaliseId(sessionId);
    const pid = normaliseId(profileId);
    const [sessionState, profileState] = await Promise.all([
      fetchSession(id),
      fetchProfile(id, pid),
    ]);

    session.id = sessionState.id;
    session.nom = sessionState.nom;
    session.merged = sessionState.merged;
    session.profiles = sessionState.profiles;
    session.final = sessionState.final;

    profile.id = profileState.id;
    profile.name = profileState.name;
    profile.ready = profileState.ready;
    for (const mode of MODES) profile.modes[mode] = profileState.modes[mode];

    status.phase = "ready";
  } catch (error) {
    status.phase = "error";
    status.message = error instanceof Error ? error.message : "Chargement impossible.";
  }
}

/**
 * TEMPORARY — Phase 3 owns this.
 *
 * The routing (`/s/{id}`), the join screen and the Profile picker do not exist
 * yet, so the ids come from the query string: `?s={session}&p={profile}`. The
 * Profile pick is remembered in `sessionStorage` — the one thing ADR 0003
 * permits there — so a tab reload does not need the `p` again.
 */
export function bootstrapFromQuery(): boolean {
  const params = new URLSearchParams(location.search);
  const sessionId = normaliseId(params.get("s") ?? "");
  if (!ID_PATTERN.test(sessionId)) return false;

  const key = `prenoms.profile.${sessionId}`;
  const fromQuery = normaliseId(params.get("p") ?? "");
  // Guarded like the localStorage cleanup: a browser that refuses storage must
  // still let you swipe, it just has to ask which Profile you are again.
  const remembered = (() => {
    try {
      return sessionStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  })();

  const profileId = ID_PATTERN.test(fromQuery) ? fromQuery : remembered;
  if (!ID_PATTERN.test(profileId)) return false;

  try {
    sessionStorage.setItem(key, profileId);
  } catch {
    // A reload will re-prompt, which is the documented fallback anyway.
  }
  void enterSession(sessionId, profileId);
  return true;
}

/* ------------------------------------------------------------------- writing */

function addressed(): { id: string; pid: string } | null {
  if (session.id === null || profile.id === null || status.phase !== "ready") return null;
  return { id: session.id, pid: profile.id };
}

/**
 * A single Verdict, keyed by (Profile, Mode, Prénom) exactly as the endpoint is.
 * The write is idempotent, so a retry is free and a re-swipe of the same Prénom
 * simply replaces whatever was still queued for it.
 */
function pushVerdict(mode: Mode, prenom: string) {
  const to = addressed();
  if (to === null) return;
  const verdict = profile.modes[mode].verdicts[prenom];
  outbox.schedule(`verdict:${mode}:${prenom}`, () =>
    verdict === undefined
      ? deleteVerdict(to.id, to.pid, mode, prenom)
      : putVerdict(to.id, to.pid, mode, prenom, verdict),
  );
}

/**
 * Ratings go up a Mode at a time, because that is the shape of the endpoint:
 * `PUT .../ratings/{mode}` replaces the whole Mode. A Duel changes two numbers,
 * and a run of Duels changes them again a second later, so sending one request
 * per Duel would be a request per tap for no gain. Instead the Mode is marked
 * dirty and a trailing debounce coalesces the run into one write — and the
 * Outbox coalesces again on the same key if a write is already in flight.
 *
 * The cost is a window in which the last Duels are only in memory, so the
 * debounce is short and it is flushed when the tab goes away.
 */
const RATINGS_DEBOUNCE = 900;

/**
 * The Ratings owed for a Mode, addressed and snapshotted at the moment the Duel
 * was resolved rather than when the timer fires. The shared-tablet case is why:
 * two people take turns on one screen, and a Profile switch between the last
 * Duel and the debounce elapsing would otherwise write one parent's Ratings on
 * to the other's Profile.
 */
type OwedRatings = {
  timer: ReturnType<typeof setTimeout>;
  to: { id: string; pid: string };
  ratings: Record<string, number>;
  duels: Record<string, number>;
};

const owed: Record<Mode, OwedRatings | null> = { male: null, female: null };

function markRatingsDirty(mode: Mode) {
  const to = addressed();
  // Unaddressable: leave whatever is already owed alone rather than dropping it.
  if (to === null) return;

  const pending = owed[mode];
  if (pending !== null) clearTimeout(pending.timer);
  owed[mode] = {
    timer: setTimeout(() => pushRatings(mode), RATINGS_DEBOUNCE),
    to,
    ratings: $state.snapshot(profile.modes[mode].ratings),
    duels: $state.snapshot(profile.modes[mode].duels),
  };
}

function pushRatings(mode: Mode) {
  const pending = owed[mode];
  if (pending === null) return;
  clearTimeout(pending.timer);
  owed[mode] = null;
  outbox.schedule(`ratings:${mode}`, () =>
    putRatings(pending.to.id, pending.to.pid, mode, pending.ratings, pending.duels),
  );
}

function flushRatings() {
  for (const mode of MODES) pushRatings(mode);
}

// The debounce is the one place a Duel can be lost to a closed tab without the
// banner ever going up, so it is cut short when the tab stops being visible.
// The write itself goes out with `keepalive`, or unloading would cancel it.
addEventListener("pagehide", flushRatings);
addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushRatings();
});

/* ---------------------------------------------------------------- UI routing */

/** The three views, swapped by a $state variable and mirrored into the URL hash. */
export type View = "browse" | "swipe" | "game";

const VIEWS: readonly View[] = ["browse", "swipe", "game"];

function viewFromHash(): View {
  const candidate = location.hash.replace(/^#\/?/, "");
  return VIEWS.find((v) => v === candidate) ?? "browse";
}

/**
 * Which Deck is in play and which view is on screen. Named `ui` and not
 * `session` because a Session is now a real thing on the server — this is only
 * where the user is looking.
 */
export const ui = $state<{ mode: Mode; view: View }>({
  mode: "female",
  view: viewFromHash(),
});

export function setMode(mode: Mode) {
  ui.mode = mode;
}

export function setView(view: View) {
  ui.view = view;
  location.hash = `#/${view}`;
}

addEventListener("hashchange", () => {
  ui.view = viewFromHash();
});

if (location.hash === "") location.replace(`#/${ui.view}`);

/** The Deck in play for the current Mode. */
export const deck = {
  get current(): Prenom[] {
    return decks[ui.mode];
  },
};

/* ------------------------------------------------------------------ verdicts */

const NOM_DEBOUNCE = 600;

let nomTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The Nom belongs to the Session, not to a Profile — one family name, shared by
 * both parents and across both Modes, and either may set it. Blank means
 * "none", stored as null so the views have one thing to test. The value is kept
 * as typed rather than trimmed — the input reads it back, so trimming here
 * would swallow the space between two words as you type it. The server trims.
 *
 * Debounced: this is fed by an `oninput`, and the Outbox only coalesces writes
 * that pile up behind one already in flight — against a fast server that would
 * still be a request per keystroke.
 */
export function setNom(value: string) {
  const nom = value.trim() === "" ? null : value;
  session.nom = nom;
  const to = addressed();
  if (to === null) return;
  if (nomTimer !== null) clearTimeout(nomTimer);
  nomTimer = setTimeout(() => {
    nomTimer = null;
    outbox.schedule("nom", () => putNom(to.id, nom).then(() => undefined));
  }, NOM_DEBOUNCE);
}

export function verdictFor(prenom: string, mode: Mode = ui.mode): Verdict | undefined {
  return profile.modes[mode].verdicts[prenom];
}

/** Starring in Parcourir and swiping right in Cartes both land here. */
export function setVerdict(prenom: string, verdict: Verdict, mode: Mode = ui.mode) {
  profile.modes[mode].verdicts[prenom] = verdict;
  pushVerdict(mode, prenom);
}

export function clearVerdict(prenom: string, mode: Mode = ui.mode) {
  delete profile.modes[mode].verdicts[prenom];
  pushVerdict(mode, prenom);
}

/* ------------------------------------------------------------------- ratings */

/**
 * Keeps Ratings in step with the Shortlist: a Prénom that gains a keep Verdict
 * enters at the median of the current Ratings, one that loses it loses its
 * Rating outright. Nobody else's Rating is touched — we do not unwind history.
 *
 * Driven off the Verdicts rather than the Deck, so a Prénom that disappears from
 * the Prénom List between builds keeps its Rating instead of having it deleted.
 *
 * Returns whether it changed anything, so hydrating a Profile that is already
 * consistent does not queue a pointless write back to the server.
 */
function syncRatings(mode: Mode): boolean {
  const state = profile.modes[mode];
  const kept = new Set(
    Object.keys(state.verdicts).filter((prenom) => state.verdicts[prenom] === "keep"),
  );

  return untrack(() => {
    let changed = false;

    for (const prenom of Object.keys(state.ratings)) {
      if (!kept.has(prenom)) {
        delete state.ratings[prenom];
        delete state.duels[prenom];
        changed = true;
      }
    }

    const entering = [...kept].filter((prenom) => state.ratings[prenom] === undefined);
    if (entering.length === 0) return changed;

    const median = medianRating(Object.values(state.ratings));
    for (const prenom of entering) {
      state.ratings[prenom] = median;
      state.duels[prenom] = 0;
    }
    return true;
  });
}

$effect.root(() => {
  $effect(() => {
    for (const mode of MODES) if (syncRatings(mode)) markRatingsDirty(mode);
  });
});

export function ratingOf(prenom: string, mode: Mode = ui.mode): number {
  return profile.modes[mode].ratings[prenom] ?? START_RATING;
}

export function duelsOf(prenom: string, mode: Mode = ui.mode): number {
  return profile.modes[mode].duels[prenom] ?? 0;
}

/**
 * Resolves one **per-Profile** Duel: both Ratings move, nothing is eliminated.
 * `duel.ts` owns this maths and the server only stores the result — only one
 * person ever writes these numbers, so there is no simultaneous-pick problem.
 * The Final Profile is the opposite case and its Elo is the server's.
 */
export function resolveDuel(winner: string, loser: string, mode: Mode = ui.mode) {
  const state = profile.modes[mode];
  const adjusted = adjust(ratingOf(winner, mode), ratingOf(loser, mode));
  state.ratings[winner] = adjusted.winner;
  state.ratings[loser] = adjusted.loser;
  state.duels[winner] = duelsOf(winner, mode) + 1;
  state.duels[loser] = duelsOf(loser, mode) + 1;
  markRatingsDirty(mode);
}
