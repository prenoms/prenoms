/**
 * The Session cache: every read and write of server state, and the rules about
 * when a write may go out at all.
 *
 * It reaches for no browser global and imports no runes. Everything it needs —
 * the state objects it mutates, the API, the Outbox, where this tab's Profile
 * pick is kept, and the timers the debounces run on — arrives through the
 * constructor. `state.svelte.ts` is the shell that supplies the real ones and
 * wraps the state in `$state`; a test supplies plain objects and fake timers.
 * That is the whole point: the invariants below are the ones worth testing, and
 * before this they were only reachable by running the app.
 *
 * Writes are optimistic. A swipe lands in memory immediately and the request
 * goes out behind it through the `Outbox`, retried with backoff. When the
 * connection stays broken the banner says so — there is no offline queue,
 * because a queue would have to be persisted (ADR 0003).
 */

import { MODES, type Mode, type Verdict } from "./domain";
import {
  copyBracket,
  drawBracket,
  duelAt,
  emptyBracket,
  needsRedraw,
  resolveBracket,
  withdrawUnkept,
  type BracketState,
  type Duel,
} from "./bracket";
import type { Outbox } from "./outbox";
import { ApiError, type FinalState, type ModeState, type ProfileState, type ProfileSummary, type SessionState } from "./api";
import { sessionPath, type Route } from "./route";

/* ------------------------------------------------------------ what it mutates */

/** The Session as anyone holding the link may see it. Never another Profile's Verdicts. */
export type SessionCacheState = {
  id: string | null;
  nom: string | null;
  merged: boolean;
  profiles: ProfileSummary[];
  final: FinalState | null;
};

/** The Profile you are acting as: your own Verdicts and your own Ranking. */
export type ProfileCacheState = {
  id: string | null;
  name: string;
  ready: boolean;
  modes: Record<Mode, ModeState>;
};

/**
 * How far the cache has got. The views read the Deck straight away, so an
 * unloaded Profile would silently look like one that has judged nothing —
 * hence a phase the shell can wait on rather than a bare boolean.
 */
export type StatusState = { phase: "idle" | "loading" | "ready" | "error"; message: string | null };

/**
 * What the banner reads. `failing` is persistent by design: it stays up for as
 * long as writes are being retried, because closing the tab in that state loses
 * them for good and the UI has to say so rather than fail quietly.
 */
export type ConnectionState = { failing: boolean; refused: string | null };

/* -------------------------------------------------------------- what it needs */

/**
 * Which Profile this tab last claimed. Not a login: it dies with the tab, which
 * is what keeps the shared-tablet case working — the next person to open the
 * link is asked who they are. The browser adapter is in the shell, because it
 * is `sessionStorage` and this module reads no globals.
 */
export type ProfileMemory = {
  recall(sessionId: string): string | null;
  remember(sessionId: string, profileId: string): void;
  forget(sessionId: string): void;
};

/** Cancels the callback if it has not run yet. */
export type Cancel = () => void;

/** One call schedules and hands back its own canceller — there is no timer id to lose. */
export type Timer = { schedule(run: () => void, ms: number): Cancel };

/** Exactly the endpoints the cache uses, so a test can supply ten short functions. */
export type Api = {
  createSession(): Promise<SessionState>;
  fetchSession(id: string): Promise<SessionState>;
  fetchProfile(id: string, profileId: string): Promise<ProfileState>;
  createProfile(id: string, name: string): Promise<ProfileState>;
  declareReady(id: string, profileId: string): Promise<SessionState>;
  putNom(id: string, nom: string | null): Promise<SessionState>;
  putVerdict(id: string, profileId: string, mode: Mode, prenom: string, verdict: Verdict): Promise<void>;
  deleteVerdict(id: string, profileId: string, mode: Mode, prenom: string): Promise<void>;
  putBracket(id: string, profileId: string, mode: Mode, bracket: BracketState): Promise<void>;
  postFinalDuel(id: string, mode: Mode, winner: string, loser: string): Promise<FinalState>;
};

export type SessionCacheDeps = {
  session: SessionCacheState;
  profile: ProfileCacheState;
  status: StatusState;
  connection: ConnectionState;
  joinError: { message: string | null };
  api: Api;
  outbox: Outbox;
  memory: ProfileMemory;
  timer: Timer;
};

/**
 * The Bracket goes up a Mode at a time, because that is the shape of the
 * endpoint: `PUT .../bracket/{mode}` replaces the whole Mode. A Duel decides one
 * node, and a run of Duels decides more a second later, so sending one request
 * per Duel would be a request per tap for no gain. Instead the Mode is marked
 * dirty and a trailing debounce coalesces the run into one write — and the
 * Outbox coalesces again on the same key if a write is already in flight.
 *
 * The cost is a window in which the last Duels are only in memory, so the
 * debounce is short and the shell flushes it when the tab goes away.
 */
const BRACKET_DEBOUNCE = 900;

/** The Nom is fed by an `oninput`; without this it would be a request per keystroke. */
const NOM_DEBOUNCE = 600;

/**
 * The Bracket owed for a Mode, addressed and snapshotted at the moment the Duel
 * was resolved rather than when the timer fires. The shared-tablet case is why:
 * two people take turns on one screen, and a Profile switch between the last
 * Duel and the debounce elapsing would otherwise write one parent's tournament
 * on to the other's Profile.
 */
type OwedBracket = { cancel: Cancel; to: Addressed; bracket: BracketState };

type Addressed = { id: string; pid: string };

function emptyModeState(): ModeState {
  return { seed: 0, verdicts: {}, bracket: emptyBracket() };
}

export function emptySessionState(): SessionCacheState {
  return { id: null, nom: null, merged: false, profiles: [], final: null };
}

export function emptyProfileState(): ProfileCacheState {
  return {
    id: null,
    name: "",
    ready: false,
    modes: { male: emptyModeState(), female: emptyModeState() },
  };
}

export class SessionCache {
  readonly #session: SessionCacheState;
  readonly #profile: ProfileCacheState;
  readonly #status: StatusState;
  readonly #connection: ConnectionState;
  readonly #joinError: { message: string | null };
  readonly #api: Api;
  readonly #outbox: Outbox;
  readonly #memory: ProfileMemory;
  readonly #timer: Timer;

  readonly #owed: Record<Mode, OwedBracket | null> = { male: null, female: null };

  /** Which Profile this tab claimed, kept past the merge — see `#finalSlot`. */
  #claimedPid: string | null = null;
  #nomPending: Cancel | null = null;

  /**
   * Final Profile Duels go out one at a time, in the order they were played, and
   * **outside the Outbox**: `POST /final/duels` is the one write in the API that
   * is not idempotent — it decides a node of the tree — so a retry after a lost
   * response would answer a question that was never asked. A Duel silently
   * played twice is worse than one openly lost, and the retry is what the Outbox
   * is for.
   *
   * The chain also settles the ordering: the response carries the whole Final
   * Profile, so an older reply landing after a newer one would put the Ranking
   * back a step.
   */
  #finalDuels: Promise<void> = Promise.resolve();

  constructor(deps: SessionCacheDeps) {
    this.#session = deps.session;
    this.#profile = deps.profile;
    this.#status = deps.status;
    this.#connection = deps.connection;
    this.#joinError = deps.joinError;
    this.#api = deps.api;
    this.#outbox = deps.outbox;
    this.#memory = deps.memory;
    this.#timer = deps.timer;

    this.#outbox.onChange(() => {
      this.#connection.failing = this.#outbox.failing;
    });
    this.#outbox.onError((error) => {
      // A refusal, not a lost swipe: the Session merged, or this Profile is
      // ready. These are terminal for the whole Session rather than for one
      // write — the optimistic cache is now showing Verdicts the server will
      // never accept — so the message stays up. Dismissing it would teach the
      // user to swipe on into a screen that has stopped meaning anything.
      this.#connection.refused = error.message;
    });
  }

  /* ----------------------------------------------------------------- loading */

  #absorbSession(state: SessionState): void {
    this.#session.id = state.id;
    this.#session.nom = state.nom;
    this.#session.merged = state.merged;
    this.#session.profiles = state.profiles;
    this.#session.final = state.final;
  }

  /**
   * Fills in a Profile and brings its Bracket into step with its Verdicts. A
   * Profile that is already consistent queues nothing — see `#syncBracket`.
   */
  #absorbProfile(state: ProfileState): void {
    this.#profile.id = state.id;
    this.#profile.name = state.name;
    this.#profile.ready = state.ready;
    for (const mode of MODES) this.#profile.modes[mode] = state.modes[mode];
    for (const mode of MODES) if (this.#syncBracket(mode)) this.#markBracketDirty(mode);
  }

  #clearCache(): void {
    Object.assign(this.#session, emptySessionState());
    Object.assign(this.#profile, { id: null, name: "", ready: false });
    for (const mode of MODES) this.#profile.modes[mode] = emptyModeState();
  }

  /**
   * Fills the cache for wherever the shell says the URL points. The Session and
   * the Profile are two requests because the Session view deliberately withholds
   * Verdicts — your own state only ever comes from the Profile endpoint,
   * addressed by its id.
   */
  async syncFrom(route: Route): Promise<void> {
    this.#handOver();
    this.#connection.refused = null;
    this.#clearCache();

    if (route.name === "home") {
      this.#status.phase = "ready";
      this.#status.message = null;
      return;
    }

    this.#status.phase = "loading";
    this.#status.message = null;
    try {
      const state = await this.#api.fetchSession(route.id);
      this.#absorbSession(state);
      // Once merged there is no private state left to fetch and no Profile to be:
      // the Final Profile belongs to the Session, so the link alone plays it.
      const pid = this.#memory.recall(route.id);
      this.#claimedPid = pid;
      if (!state.merged && pid !== null) await this.#hydrateProfile(route.id, pid);
      this.#status.phase = "ready";
    } catch (error) {
      this.#status.phase = "error";
      this.#status.message = error instanceof Error ? error.message : "Chargement impossible.";
    }
  }

  /**
   * Re-reads the Session without disturbing the Profile cache. What the join
   * screen and the ready dialog say about the other Profile is a snapshot from
   * page load otherwise, and "they have not finished yet" going stale is exactly
   * the blind confirmation the dialog exists to prevent (ADR 0003).
   */
  async refreshSession(): Promise<void> {
    const id = this.#session.id;
    if (id === null) return;
    try {
      this.#absorbSession(await this.#api.fetchSession(id));
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
  async #hydrateProfile(id: string, pid: string): Promise<void> {
    try {
      this.#absorbProfile(await this.#api.fetchProfile(id, pid));
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_found") {
        this.#memory.forget(id);
        return;
      }
      throw error;
    }
  }

  /**
   * The shared tablet: one screen, two parents, taking turns. Whatever the
   * outgoing Profile still owes goes out addressed to them *before* the cache
   * becomes somebody else's.
   *
   * The address snapshot in `#markBracketDirty` is not enough on its own —
   * absorbing the incoming Profile marks their Bracket dirty too, and that
   * cancels the outgoing Profile's pending timer and takes its slot. Without
   * this the last Duels before a handover are lost silently, which is the one
   * failure mode the banner cannot report because no request was ever made.
   */
  #handOver(): void {
    this.flush();
  }

  /* ----------------------------------------------------------------- joining */

  /**
   * Creates a Session and returns the path that hands over the link — the shell
   * navigates. Losing the link loses the Session for good, so that screen comes
   * before the app rather than after it (ADR 0003). Null means it failed and
   * `status` says why.
   */
  async beginSession(): Promise<string | null> {
    this.#status.phase = "loading";
    this.#status.message = null;
    try {
      const state = await this.#api.createSession();
      return `${sessionPath(state.id)}#/share`;
    } catch (error) {
      this.#status.phase = "error";
      this.#status.message = error instanceof Error ? error.message : "Création impossible.";
      return null;
    }
  }

  /**
   * Claims an existing Profile. No password: the Session id is the whole key.
   *
   * A failure here leaves the Session loaded and the join screen usable, so it is
   * reported there rather than as a dead end — the other Profile is still a
   * perfectly good thing to try.
   */
  async claimProfile(pid: string): Promise<boolean> {
    const id = this.#session.id;
    if (id === null) return false;
    this.#handOver();
    this.#joinError.message = null;
    this.#status.phase = "loading";
    try {
      this.#absorbProfile(await this.#api.fetchProfile(id, pid));
      this.#memory.remember(id, pid);
      this.#claimedPid = pid;
      this.#status.phase = "ready";
      return true;
    } catch (error) {
      this.#status.phase = "ready";
      this.#joinError.message = error instanceof Error ? error.message : "Entrée impossible.";
      return false;
    }
  }

  /**
   * Adds a Profile to the Session and becomes it. The Profile list is extended
   * from the response rather than re-fetched: the server has just told us
   * everything the Session view would.
   */
  async addProfile(name: string): Promise<boolean> {
    const id = this.#session.id;
    if (id === null) return false;
    this.#handOver();
    this.#joinError.message = null;
    this.#status.phase = "loading";
    try {
      const created = await this.#api.createProfile(id, name);
      this.#absorbProfile(created);
      this.#session.profiles = [
        ...this.#session.profiles,
        { id: created.id, name: created.name, ready: created.ready },
      ];
      this.#memory.remember(id, created.id);
      this.#claimedPid = created.id;
      this.#status.phase = "ready";
      return true;
    } catch (error) {
      // A name already taken or a third Profile: the Session is fine, the request
      // was not, so stay on the join screen and say why.
      this.#status.phase = "ready";
      this.#joinError.message = error instanceof Error ? error.message : "Profil impossible à créer.";
      return false;
    }
  }

  /**
   * Irreversible, and it merges the Session if every Profile is then ready. The
   * Outbox is drained first: a Verdict still in flight would arrive after the
   * merge and be refused, which would raise the banner over a swipe the user
   * genuinely made.
   */
  async declareReady(): Promise<void> {
    const id = this.#session.id;
    const pid = this.#profile.id;
    if (id === null || pid === null) return;
    this.flush();
    await this.#outbox.settled();
    try {
      this.#absorbSession(await this.#api.declareReady(id, pid));
      this.#profile.ready = true;
    } catch (error) {
      // The banner, not the error screen: the Session is intact and what is on
      // screen still works — it is this one refusal that has to be said out loud.
      this.#connection.refused = error instanceof Error ? error.message : "Impossible de terminer.";
    }
  }

  /* ----------------------------------------------------------------- writing */

  /**
   * Where a per-Profile write goes, or null if there is nowhere to send it. Ready
   * and merged are checked here rather than at each call site: after either, the
   * server refuses every Verdict and Bracket, and a write that is certain to be
   * refused is better never sent than shown to the user as a refusal.
   */
  #addressed(): Addressed | null {
    const id = this.#session.id;
    const pid = this.#profile.id;
    if (id === null || pid === null || this.#status.phase !== "ready") return null;
    if (this.#profile.ready || this.#session.merged) return null;
    return { id, pid };
  }

  /**
   * A single Verdict, keyed by (Profile, Mode, Prénom) exactly as the endpoint is.
   * The write is idempotent, so a retry is free and a re-swipe of the same Prénom
   * simply replaces whatever was still queued for it.
   */
  #pushVerdict(mode: Mode, prenom: string): void {
    const to = this.#addressed();
    if (to === null) return;
    const verdict = this.#profile.modes[mode].verdicts[prenom];
    this.#outbox.schedule(`verdict:${mode}:${prenom}`, () =>
      verdict === undefined
        ? this.#api.deleteVerdict(to.id, to.pid, mode, prenom)
        : this.#api.putVerdict(to.id, to.pid, mode, prenom, verdict),
    );
  }

  #markBracketDirty(mode: Mode): void {
    const to = this.#addressed();
    // Unaddressable: leave whatever is already owed alone rather than dropping it.
    if (to === null) return;

    this.#owed[mode]?.cancel();
    this.#owed[mode] = {
      cancel: this.#timer.schedule(() => this.#pushBracket(mode), BRACKET_DEBOUNCE),
      to,
      bracket: copyBracket(this.#profile.modes[mode].bracket),
    };
  }

  #pushBracket(mode: Mode): void {
    const pending = this.#owed[mode];
    if (pending === null) return;
    pending.cancel();
    this.#owed[mode] = null;
    this.#outbox.schedule(`bracket:${mode}`, () =>
      this.#api.putBracket(pending.to.id, pending.to.pid, mode, pending.bracket),
    );
  }

  /**
   * Cuts every debounce short and hands what is owed to the Outbox. The shell
   * calls this on `pagehide` and when the tab is hidden: the debounce is the one
   * place a Duel can be lost to a closed tab without the banner ever going up.
   */
  flush(): void {
    for (const mode of MODES) this.#pushBracket(mode);
    this.#nomPending?.();
    this.#nomPending = null;
  }

  /**
   * The Nom belongs to the Session, not to a Profile — one family name, shared by
   * both parents and across both Modes, and either may set it. Blank means
   * "none", stored as null so the views have one thing to test. The value is kept
   * as typed rather than trimmed — the input reads it back, so trimming here
   * would swallow the space between two words as you type it. The server trims.
   */
  setNom(value: string): void {
    const nom = value.trim() === "" ? null : value;
    this.#session.nom = nom;
    // Not `#addressed()`: the Nom is the Session's, so it outlives both the merge
    // and being ready, and it needs no Profile to write.
    const id = this.#session.id;
    if (id === null || this.#status.phase !== "ready") return;
    this.#nomPending?.();
    this.#nomPending = this.#timer.schedule(() => {
      this.#nomPending = null;
      this.#outbox.schedule("nom", () => this.#api.putNom(id, nom).then(() => undefined));
    }, NOM_DEBOUNCE);
  }

  verdictFor(mode: Mode, prenom: string): Verdict | undefined {
    return this.#profile.modes[mode].verdicts[prenom];
  }

  /** Starring in Parcourir and swiping right in Cartes both land here. */
  setVerdict(mode: Mode, prenom: string, verdict: Verdict): void {
    this.#profile.modes[mode].verdicts[prenom] = verdict;
    this.#pushVerdict(mode, prenom);
    if (this.#syncBracket(mode)) this.#markBracketDirty(mode);
  }

  clearVerdict(mode: Mode, prenom: string): void {
    delete this.#profile.modes[mode].verdicts[prenom];
    this.#pushVerdict(mode, prenom);
    if (this.#syncBracket(mode)) this.#markBracketDirty(mode);
  }

  /* ----------------------------------------------------------------- bracket */

  /** The Shortlist for one Mode: every Prénom this Profile has a keep Verdict on. */
  #shortlist(mode: Mode): string[] {
    const verdicts = this.#profile.modes[mode].verdicts;
    return Object.keys(verdicts).filter((prenom) => verdicts[prenom] === "keep");
  }

  /**
   * Withdraws from the Bracket every Prénom that has lost its keep Verdict.
   * Newcomers are not slipped in — see `withdrawUnkept` — so this never
   * silently invalidates Duels that were honestly played.
   *
   * Called from the three places a Verdict can change — `setVerdict`,
   * `clearVerdict` and hydration — rather than from an effect watching them.
   * Returns whether it changed anything, so hydrating a Profile that is already
   * in step does not queue a pointless write back to the server.
   */
  #syncBracket(mode: Mode): boolean {
    const next = withdrawUnkept(this.#profile.modes[mode].bracket, this.#shortlist(mode));
    if (next === null) return false;
    this.#profile.modes[mode].bracket = next;
    return true;
  }

  bracketOf(mode: Mode): BracketState {
    return this.#profile.modes[mode].bracket;
  }

  /** Whether the Shortlist holds Prénoms this Profile's Bracket never drew. */
  bracketIsStale(mode: Mode): boolean {
    return needsRedraw(this.#profile.modes[mode].bracket, this.#shortlist(mode));
  }

  /**
   * Draws this Profile's Bracket afresh over its whole Shortlist. Always the
   * user's own doing: a redraw throws away every Duel already played, so it is
   * a button on the screen and never a consequence of swiping.
   */
  drawBracket(mode: Mode): void {
    this.#profile.modes[mode].bracket = drawBracket(this.#shortlist(mode));
    this.#markBracketDirty(mode);
  }

  /** The Duel this Profile owes, or null once its podium is decided. */
  duelFor(mode: Mode): Duel | null {
    return duelAt(this.#profile.modes[mode].bracket, 0);
  }

  /**
   * Resolves one **per-Profile** Duel. `bracket.ts` owns the rules and the
   * server only stores the state — only one person ever plays this tournament,
   * so there is no simultaneous-pick problem. The Final Profile is the opposite
   * case, and its tree is the server's.
   */
  resolveDuel(mode: Mode, winner: string, loser: string): void {
    const next = resolveBracket(this.#profile.modes[mode].bracket, winner, loser);
    // Stale: the Shortlist moved under the screen. The next question stands.
    if (next === null) return;
    this.#profile.modes[mode].bracket = next;
    this.#markBracketDirty(mode);
  }

  /* ----------------------------------------------------------- Final Profile */

  /**
   * Which of the Final Profile's Duels is this device's. One slot per Profile,
   * assigned by position in the Session, so two parents at two screens are
   * never handed the same question and neither waits on the other. A device
   * that never claimed a Profile takes the first slot.
   */
  #finalSlot(): number {
    const index = this.#session.profiles.findIndex((p) => p.id === this.#claimedPid);
    return index < 0 ? 0 : index;
  }

  finalBracketOf(mode: Mode): BracketState {
    return this.#session.final?.modes[mode].bracket ?? emptyBracket();
  }

  finalDuelFor(mode: Mode): Duel | null {
    return duelAt(this.finalBracketOf(mode), this.#finalSlot());
  }

  /**
   * Resolves one **Final Profile** Duel. Only the fact is sent: what it settles
   * is worked out by PHP inside the lock, so two parents picking at the same
   * moment both count (ADR 0003). Never resolve it here — `bracket.ts` owns the
   * per-Profile phase and nothing else.
   *
   * A `409` means the other parent answered this Duel first. That is a race, not
   * a failure: the Session is re-read so the screen moves on to the next
   * question, and the banner stays down. Anything else is a lost Duel and says so.
   */
  resolveFinalDuel(mode: Mode, winner: string, loser: string): void {
    const id = this.#session.id;
    if (id === null || this.#session.final === null) return;

    this.#finalDuels = this.#finalDuels.then(async () => {
      try {
        this.#session.final = await this.#api.postFinalDuel(id, mode, winner, loser);
      } catch (error) {
        if (error instanceof ApiError && error.code === "conflict") {
          await this.refreshSession();
          return;
        }
        this.#connection.refused =
          error instanceof Error ? error.message : "Ce duel n'a pas été enregistré.";
      }
    });
  }

  /** Resolves once every Final Profile Duel played so far has been answered. */
  finalDuelsSettled(): Promise<void> {
    return this.#finalDuels;
  }
}
