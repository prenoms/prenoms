import type { Mode, Prenom, Verdict } from "./domain";
import { Outbox } from "./outbox";
import * as api from "./api";
import { ID_PATTERN, normaliseId } from "./api";
import { parseRoute, type Route } from "./route";
import {
  SessionCache,
  emptyProfileState,
  emptySessionState,
  type Cancel,
  type ProfileMemory,
  type Timer,
} from "./session-cache";

/**
 * The shell around the Session cache. Three things live here and nothing else:
 * the `$state` the views read (runes only compile in a `.svelte.ts` file), the
 * browser — `location`, `history`, `sessionStorage`, timers, the event
 * listeners — and the Deck.
 *
 * Every rule about server state is in `session-cache.ts`, which reaches for no
 * global and is therefore testable; this file is the wiring that gives it real
 * ones. If you are adding behaviour, it almost certainly belongs there.
 */

/** The one thing left in browser storage, cleared on first load. Nothing is
 *  migrated — the old Verdicts are gone by design (ADR 0003). Wrapped because a
 *  browser that refuses storage must not take the whole app down over a cleanup. */
try {
  localStorage.removeItem("prenoms");
} catch {
  // Nothing to clear, and nothing we could do about it.
}

/* -------------------------------------------------------------- the raw state */

export const session = $state(emptySessionState());
export const profile = $state(emptyProfileState());
export const status = $state<{ phase: "idle" | "loading" | "ready" | "error"; message: string | null }>(
  { phase: "idle", message: null },
);
export const connection = $state<{ failing: boolean; refused: string | null }>({
  failing: false,
  refused: null,
});

/** What the join screen shows when the server refuses a name. Cleared on retry. */
export const joinError = $state<{ message: string | null }>({ message: null });

/* ------------------------------------------------------------ browser adapters */

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

const browserMemory: ProfileMemory = {
  recall(id) {
    try {
      const pid = normaliseId(sessionStorage.getItem(profileKey(id)) ?? "");
      return ID_PATTERN.test(pid) ? pid : null;
    } catch {
      return null;
    }
  },
  remember(id, pid) {
    try {
      sessionStorage.setItem(profileKey(id), pid);
    } catch {
      // A reload will re-prompt, which is the documented fallback anyway.
    }
  },
  forget(id) {
    try {
      sessionStorage.removeItem(profileKey(id));
    } catch {
      // Nothing to clear, and nothing we could do about it.
    }
  },
};

const browserTimer: Timer = {
  schedule(run, ms): Cancel {
    const handle = setTimeout(run, ms);
    return () => clearTimeout(handle);
  },
};

const cache = new SessionCache({
  session,
  profile,
  status,
  connection,
  joinError,
  api,
  outbox: new Outbox(),
  memory: browserMemory,
  timer: browserTimer,
});

/* --------------------------------------------------------------------- routing */

/**
 * Where the app is. The Session id is in the path, so the link is a real URL
 * that a cold visit resolves through the SPA fallback; `route.ts` owns the
 * parsing and is tested there.
 *
 * Wrapped in `current` so the exported binding can hold the union whole and
 * `route.current.name === "session"` narrows to something with an id.
 */
export const route = $state<{ current: Route }>({ current: { name: "home" } });

/** The path the cache was filled from, so a hash-only Back does not refill it. */
let loadedPath: string | null = null;

/** Reads the URL, then asks the cache to match it. Called on load and on every
 *  navigation that changes the path. */
export async function syncFromUrl(): Promise<void> {
  loadedPath = location.pathname;
  route.current = parseRoute(location.pathname);
  ui.view = viewFromHash();
  await cache.syncFrom(route.current);
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

// The debounce is the one place a Duel can be lost to a closed tab without the
// banner ever going up, so it is cut short when the tab stops being visible.
// The write itself goes out with `keepalive`, or unloading would cancel it.
addEventListener("pagehide", () => cache.flush());
addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") cache.flush();
});

/* ------------------------------------------------------------------ UI routing */

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

/* ---------------------------------------------------------------------- Decks */

/**
 * The Prénom List is fetched once by `main.ts` before the app mounts, rather
 * than on import — a module that fetches when it is imported cannot be imported
 * by a test.
 */
let loadedDecks: Record<Mode, Prenom[]> = { male: [], female: [] };

export function initDecks(decks: Record<Mode, Prenom[]>) {
  loadedDecks = decks;
}

/** The Deck in play for the current Mode. */
export const deck = {
  get current(): Prenom[] {
    return loadedDecks[ui.mode];
  },
};

/* ------------------------------------------------------- the cache's interface */

/*
 * Every operation names its Mode. The cache cannot read `ui.mode` — it reaches
 * for nothing — and having each call say which Deck it is judging is the point:
 * a Verdict is keyed by (Profile, Mode, Prénom), and now so is the call.
 */

export const refreshSession = () => cache.refreshSession();
export const declareReadyNow = () => cache.declareReady();

// Becoming a Profile is the one thing that also moves you off the join screen.
// The cache reports whether it worked; where that lands you is the shell's.
export async function claimProfile(pid: string): Promise<void> {
  if (await cache.claimProfile(pid)) setView("swipe");
}

export async function addProfile(name: string): Promise<void> {
  if (await cache.addProfile(name)) setView("swipe");
}

export const setNom = (value: string) => cache.setNom(value);

export const verdictFor = (mode: Mode, prenom: string) => cache.verdictFor(mode, prenom);
export const setVerdict = (mode: Mode, prenom: string, verdict: Verdict) =>
  cache.setVerdict(mode, prenom, verdict);
export const clearVerdict = (mode: Mode, prenom: string) => cache.clearVerdict(mode, prenom);

export const bracketOf = (mode: Mode) => cache.bracketOf(mode);
export const bracketIsStale = (mode: Mode) => cache.bracketIsStale(mode);
export const drawBracket = (mode: Mode) => cache.drawBracket(mode);
export const duelFor = (mode: Mode) => cache.duelFor(mode);
export const resolveDuel = (mode: Mode, winner: string, loser: string) =>
  cache.resolveDuel(mode, winner, loser);

export const finalBracketOf = (mode: Mode) => cache.finalBracketOf(mode);
export const finalDuelFor = (mode: Mode) => cache.finalDuelFor(mode);
export const resolveFinalDuel = (mode: Mode, winner: string, loser: string) =>
  cache.resolveFinalDuel(mode, winner, loser);

/**
 * Creates a Session and lands on the screen that hands over the link. Losing
 * the link loses the Session for good, so that screen comes before the app
 * rather than after it (ADR 0003).
 */
export async function beginSession(): Promise<void> {
  const path = await cache.beginSession();
  if (path !== null) go(path);
}
