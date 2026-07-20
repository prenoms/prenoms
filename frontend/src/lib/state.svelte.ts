import { untrack } from "svelte";
import { MODES, type Mode, type Prenom, type Verdict } from "./domain";
import { adjust, medianRating, START_RATING } from "./duel";
import { decks } from "./prenom-list";
import { Outbox } from "./outbox";
import {
  ApiError,
  ID_PATTERN,
  normaliseId,
  createProfile,
  createSession,
  declareReady,
  deleteVerdict,
  fetchProfile,
  fetchSession,
  postFinalDuel,
  putNom,
  putRatings,
  putVerdict,
  type FinalState,
  type ModeState,
  type ProfileState,
  type ProfileSummary,
  type SessionState,
} from "./api";
import { parseRoute, sessionPath, type Route } from "./route";

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

/* ------------------------------------------------------------------ routing */

/**
 * Where the app is. The Session id is in the path, so the link is a real URL
 * that a cold visit resolves through the SPA fallback; `route.ts` owns the
 * parsing and is tested there.
 *
 * Wrapped in `current` so the exported binding can hold the union whole and
 * `route.current.name === "session"` narrows to something with an id.
 */
export const route = $state<{ current: Route }>({ current: { name: "home" } });

/**
 * Which Profile you last claimed in this Session, in `sessionStorage` — the one
 * thing ADR 0003 permits there, so that a tab reload does not re-prompt. It
 * dies with the tab, which is what keeps the shared-tablet case working: the
 * next person to open the link is asked who they are.
 *
 * Every access is guarded: a browser that refuses storage must still let you
 * swipe, it just has to ask again.
 */
const profileKey = (id: string) => `prenoms.profile.${id}`;

function rememberedProfile(id: string): string | null {
  try {
    const pid = normaliseId(sessionStorage.getItem(profileKey(id)) ?? "");
    return ID_PATTERN.test(pid) ? pid : null;
  } catch {
    return null;
  }
}

function rememberProfile(id: string, pid: string) {
  try {
    sessionStorage.setItem(profileKey(id), pid);
  } catch {
    // A reload will re-prompt, which is the documented fallback anyway.
  }
}

function forgetProfile(id: string) {
  try {
    sessionStorage.removeItem(profileKey(id));
  } catch {
    // Nothing to clear, and nothing we could do about it.
  }
}

/* ------------------------------------------------------------------ loading */

function absorbSession(state: SessionState) {
  session.id = state.id;
  session.nom = state.nom;
  session.merged = state.merged;
  session.profiles = state.profiles;
  session.final = state.final;
}

function absorbProfile(state: ProfileState) {
  profile.id = state.id;
  profile.name = state.name;
  profile.ready = state.ready;
  for (const mode of MODES) profile.modes[mode] = state.modes[mode];
}

function clearCache() {
  session.id = null;
  session.nom = null;
  session.merged = false;
  session.profiles = [];
  session.final = null;
  profile.id = null;
  profile.name = "";
  profile.ready = false;
  for (const mode of MODES) profile.modes[mode] = emptyModeState();
}

/** The path the cache was filled from, so a hash-only Back does not refill it. */
let loadedPath: string | null = null;

/**
 * Fills the cache for whatever the URL says. The Session and the Profile are
 * two requests because the Session view deliberately withholds Verdicts — your
 * own state only ever comes from the Profile endpoint, addressed by its id.
 *
 * Called on load and on every navigation that changes the path.
 */
export async function syncFromUrl(): Promise<void> {
  // Whatever the outgoing Profile still owes goes out addressed to them, before
  // the cache becomes somebody else's — the shared-tablet handover.
  flushRatings();
  connection.refused = null;

  loadedPath = location.pathname;
  route.current = parseRoute(location.pathname);
  ui.view = viewFromHash();
  clearCache();

  if (route.current.name === "home") {
    status.phase = "ready";
    status.message = null;
    return;
  }

  status.phase = "loading";
  status.message = null;
  const id = route.current.id;
  try {
    const state = await fetchSession(id);
    absorbSession(state);
    // Once merged there is no private state left to fetch and no Profile to be:
    // the Final Profile belongs to the Session, so the link alone plays it.
    const pid = rememberedProfile(id);
    if (!state.merged && pid !== null) await hydrateProfile(id, pid);
    status.phase = "ready";
  } catch (error) {
    status.phase = "error";
    status.message = error instanceof Error ? error.message : "Chargement impossible.";
  }
}

/**
 * Re-reads the Session without disturbing the Profile cache. What the join
 * screen and the ready dialog say about the other Profile is a snapshot from
 * page load otherwise, and "they have not finished yet" going stale is exactly
 * the blind confirmation the dialog exists to prevent (ADR 0003).
 */
export async function refreshSession(): Promise<void> {
  const id = session.id;
  if (id === null) return;
  try {
    absorbSession(await fetchSession(id));
  } catch {
    // A refresh is a courtesy: what is on screen is still what we last knew,
    // and any write that matters raises the banner on its own.
  }
}

/**
 * A remembered Profile the Session no longer knows about is not an error — the
 * Session may have been swept and recreated. Forget it and let the join screen
 * ask again, rather than stranding the tab on a failure it cannot act on.
 */
async function hydrateProfile(id: string, pid: string): Promise<void> {
  try {
    absorbProfile(await fetchProfile(id, pid));
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") {
      forgetProfile(id);
      return;
    }
    throw error;
  }
}

/** A real navigation: the URL changes, then the cache is refilled to match it. */
export function go(path: string) {
  history.pushState(null, "", path);
  void syncFromUrl();
}

// Back and Forward. Only a changed *path* is a new Session: `setView` writes the
// hash, which also pushes a history entry, and refilling the cache for that
// would throw away Verdicts still queued in the Outbox — the swipe would
// visibly undo itself. The hash is handled by `hashchange` alone.
addEventListener("popstate", () => {
  if (location.pathname !== loadedPath) void syncFromUrl();
});

/* ------------------------------------------------------------------ joining */

/**
 * Creates a Session and lands on the screen that hands over the link. Losing
 * the link loses the Session for good, so that screen comes before the app
 * rather than after it (ADR 0003).
 */
export async function beginSession(): Promise<void> {
  status.phase = "loading";
  status.message = null;
  try {
    const state = await createSession();
    go(`${sessionPath(state.id)}#/share`);
  } catch (error) {
    status.phase = "error";
    status.message = error instanceof Error ? error.message : "Création impossible.";
  }
}

/** What the join screen shows when the server refuses a name. Cleared on retry. */
export const joinError = $state<{ message: string | null }>({ message: null });

/**
 * Claims an existing Profile. No password: the Session id is the whole key.
 *
 * A failure here leaves the Session loaded and the join screen usable, so it is
 * reported there rather than as a dead end — the other Profile is still a
 * perfectly good thing to try.
 */
export async function claimProfile(pid: string): Promise<void> {
  const id = session.id;
  if (id === null) return;
  joinError.message = null;
  status.phase = "loading";
  try {
    absorbProfile(await fetchProfile(id, pid));
    rememberProfile(id, pid);
    setView("swipe");
    status.phase = "ready";
  } catch (error) {
    status.phase = "ready";
    joinError.message = error instanceof Error ? error.message : "Entrée impossible.";
  }
}

/**
 * Adds a Profile to the Session and becomes it. The Profile list is extended
 * from the response rather than re-fetched: the server has just told us
 * everything the Session view would.
 */
export async function addProfile(name: string): Promise<void> {
  const id = session.id;
  if (id === null) return;
  joinError.message = null;
  status.phase = "loading";
  try {
    const created = await createProfile(id, name);
    absorbProfile(created);
    session.profiles = [
      ...session.profiles,
      { id: created.id, name: created.name, ready: created.ready },
    ];
    rememberProfile(id, created.id);
    setView("swipe");
    status.phase = "ready";
  } catch (error) {
    // A name already taken or a third Profile: the Session is fine, the request
    // was not, so stay on the join screen and say why.
    status.phase = "ready";
    joinError.message = error instanceof Error ? error.message : "Profil impossible à créer.";
  }
}

/**
 * Irreversible, and it merges the Session if every Profile is then ready. The
 * Outbox is drained first: a Verdict still in flight would arrive after the
 * merge and be refused, which would raise the banner over a swipe the user
 * genuinely made.
 */
export async function declareReadyNow(): Promise<void> {
  const id = session.id;
  const pid = profile.id;
  if (id === null || pid === null) return;
  flushRatings();
  await outbox.settled();
  try {
    absorbSession(await declareReady(id, pid));
    profile.ready = true;
  } catch (error) {
    // The banner, not the error screen: the Session is intact and what is on
    // screen still works — it is this one refusal that has to be said out loud.
    connection.refused = error instanceof Error ? error.message : "Impossible de terminer.";
  }
}

/* ------------------------------------------------------------------- writing */

/**
 * Where a per-Profile write goes, or null if there is nowhere to send it. Ready
 * and merged are checked here rather than at each call site: after either, the
 * server refuses every Verdict and Rating, and a write that is certain to be
 * refused is better never sent than shown to the user as a refusal.
 */
function addressed(): { id: string; pid: string } | null {
  if (session.id === null || profile.id === null || status.phase !== "ready") return null;
  if (profile.ready || session.merged) return null;
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

/**
 * The views, swapped by a $state variable and mirrored into the URL hash. Three
 * are the app; `share` is the screen that hands over the link, which is a view
 * rather than a moment so that it stays reachable — the link is the only key
 * there is, and someone who mislaid it while their tab is still open can copy
 * it again (ADR 0003).
 */
export type View = "browse" | "swipe" | "game" | "share";

const VIEWS: readonly View[] = ["browse", "swipe", "game", "share"];

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
  // Not `addressed()`: the Nom is the Session's, so it outlives both the merge
  // and being ready, and it needs no Profile to write.
  const id = session.id;
  if (id === null || status.phase !== "ready") return;
  if (nomTimer !== null) clearTimeout(nomTimer);
  nomTimer = setTimeout(() => {
    nomTimer = null;
    outbox.schedule("nom", () => putNom(id, nom).then(() => undefined));
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

/* ------------------------------------------------------- the Final Profile */

/**
 * Final Profile Duels go out one at a time, in the order they were played, and
 * **outside the Outbox**: `POST /final/duels` is the one write in the API that
 * is not idempotent — it applies an Elo adjustment and two increments per call
 * — so a retry after a lost response would count the same Duel twice. A Duel
 * silently played twice is worse than one openly lost, and the retry is what
 * the Outbox is for.
 *
 * The chain also settles the ordering: the response carries the whole Final
 * Profile, so an older reply landing after a newer one would put the Ranking
 * back a step.
 */
let finalDuels: Promise<void> = Promise.resolve();

/**
 * Resolves one **Final Profile** Duel. Only the fact is sent: the Elo is
 * computed by PHP inside the lock, so two parents picking at the same moment
 * both count (ADR 0003). Never compute it here — `duel.ts` owns the per-Profile
 * phase and nothing else.
 *
 * The Duel counts move locally straight away so the pairing keeps its rhythm;
 * the Ratings only ever come back from the server.
 */
export function resolveFinalDuel(winner: string, loser: string, mode: Mode = ui.mode) {
  const id = session.id;
  const final = session.final;
  if (id === null || final === null) return;

  const counts = final.modes[mode].duels;
  counts[winner] = (counts[winner] ?? 0) + 1;
  counts[loser] = (counts[loser] ?? 0) + 1;

  finalDuels = finalDuels.then(async () => {
    try {
      session.final = await postFinalDuel(id, mode, winner, loser);
    } catch (error) {
      connection.refused =
        error instanceof Error ? error.message : "Ce duel n'a pas été enregistré.";
    }
  });
}

export function finalRatingOf(prenom: string, mode: Mode = ui.mode): number {
  return session.final?.modes[mode].ratings[prenom] ?? START_RATING;
}

export function finalDuelsOf(prenom: string, mode: Mode = ui.mode): number {
  return session.final?.modes[mode].duels[prenom] ?? 0;
}
