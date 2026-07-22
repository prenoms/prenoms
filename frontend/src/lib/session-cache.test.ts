import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, type FinalState, type ModeState, type ProfileState, type SessionState } from "./api";
import { Outbox } from "./outbox";
import { drawBracket, emptyBracket, resolveBracket } from "./bracket";
import {
  SessionCache,
  emptyProfileState,
  emptySessionState,
  type Api,
  type Cancel,
  type ProfileMemory,
  type Timer,
} from "./session-cache";

/**
 * The cache reaches for no browser global, so a whole Session can be driven
 * here: join, swipe, duel, hand the tablet over, go ready. These are the rules
 * that used to be reachable only by running the app.
 */

/** Records every call, and lets a test decide what each endpoint answers. */
function fakeApi() {
  const calls: string[] = [];
  const session = (over: Partial<SessionState> = {}): SessionState => ({
    id: "K7M2QX9RTB",
    nom: null,
    merged: false,
    profiles: [{ id: "PROFILEAAA", name: "A", ready: false }],
    final: null,
    ...over,
  });
  const mode = (over: Partial<ModeState> = {}): ModeState => ({
    seed: 1,
    verdicts: {},
    bracket: emptyBracket(),
    ...over,
  });
  const profile = (over: Partial<ProfileState> = {}): ProfileState => ({
    id: "PROFILEAAA",
    name: "A",
    ready: false,
    modes: { male: mode(), female: mode() },
    ...over,
  });

  const state = {
    calls,
    session,
    profile,
    mode,
    nextSession: session(),
    nextProfile: profile(),
    nextFinal: { modes: { male: { bracket: emptyBracket() }, female: { bracket: emptyBracket() } } } as FinalState,
    /** Set to make the next call of that name reject. */
    fail: null as { on: string; error: Error } | null,
  };

  function record<T>(name: string, value: T): Promise<T> {
    calls.push(name);
    if (state.fail?.on === name) {
      const { error } = state.fail;
      state.fail = null;
      return Promise.reject(error);
    }
    return Promise.resolve(value);
  }

  // Note the closures read `state`, so the object itself is returned rather than
  // a spread of it — a copy would take the test's `nextSession` nowhere.
  const api: Api = {
    createSession: () => record("createSession", state.nextSession),
    fetchSession: () => record("fetchSession", state.nextSession),
    fetchProfile: () => record("fetchProfile", state.nextProfile),
    createProfile: () => record("createProfile", state.nextProfile),
    declareReady: () => record("declareReady", state.nextSession),
    putNom: () => record("putNom", state.nextSession),
    putVerdict: (_i, _p, m, prenom, v) => record(`putVerdict:${m}:${prenom}=${v}`, undefined),
    deleteVerdict: (_i, _p, m, prenom) => record(`deleteVerdict:${m}:${prenom}`, undefined),
    putBracket: (_i, pid, m, bracket) =>
      record(`putBracket:${pid}:${m}:${bracket.field.join(",")}`, undefined),
    postFinalDuel: (_i, m, w, l) => record(`postFinalDuel:${m}:${w}>${l}`, state.nextFinal),
  };

  return Object.assign(state, { api });
}

/** Debounces fire when the test says so, not seconds later. */
function fakeTimer() {
  let pending: (() => void)[] = [];
  const timer: Timer = {
    schedule(run): Cancel {
      const entry = () => run();
      pending.push(entry);
      return () => {
        pending = pending.filter((p) => p !== entry);
      };
    },
  };
  return {
    timer,
    get count() {
      return pending.length;
    },
    fire() {
      const due = pending;
      pending = [];
      for (const run of due) run();
    },
  };
}

function inMemory(): ProfileMemory & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    recall: (id) => store.get(id) ?? null,
    remember: (id, pid) => void store.set(id, pid),
    forget: (id) => void store.delete(id),
  };
}

function build() {
  const api = fakeApi();
  const clock = fakeTimer();
  const memory = inMemory();
  const state = {
    session: emptySessionState(),
    profile: emptyProfileState(),
    status: { phase: "idle" as const, message: null as string | null },
    connection: { failing: false, refused: null as string | null },
    joinError: { message: null as string | null },
  };
  const outbox = new Outbox({ delay: () => Promise.resolve() });
  const cache = new SessionCache({ ...state, api: api.api, outbox, memory, timer: clock.timer });
  return { cache, api, clock, memory, outbox, ...state };
}

/** A loaded Session with a claimed Profile — the state most rules are about. */
async function joined() {
  const kit = build();
  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });
  await kit.cache.claimProfile("PROFILEAAA");
  kit.api.calls.length = 0;
  return kit;
}

/* ------------------------------------------------------------------- loading */

test("the home route loads nothing and is ready straight away", async () => {
  const kit = build();
  await kit.cache.syncFrom({ name: "home" });
  assert.equal(kit.status.phase, "ready");
  assert.deepEqual(kit.api.calls, []);
});

test("a Session route fetches the Session, and the Profile only once claimed", async () => {
  const kit = build();
  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });

  assert.deepEqual(kit.api.calls, ["fetchSession"]);
  assert.equal(kit.session.id, "K7M2QX9RTB");
  assert.equal(kit.profile.id, null, "nobody has said who they are yet");
  assert.equal(kit.status.phase, "ready");
});

test("a remembered Profile is hydrated without asking again", async () => {
  const kit = build();
  kit.memory.store.set("K7M2QX9RTB", "PROFILEAAA");
  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });

  assert.deepEqual(kit.api.calls, ["fetchSession", "fetchProfile"]);
  assert.equal(kit.profile.id, "PROFILEAAA");
});

test("a merged Session hydrates no Profile — the link alone plays the Final Profile", async () => {
  const kit = build();
  kit.memory.store.set("K7M2QX9RTB", "PROFILEAAA");
  kit.api.nextSession = kit.api.session({ merged: true, final: kit.api.nextFinal });
  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });

  assert.deepEqual(kit.api.calls, ["fetchSession"]);
  assert.equal(kit.profile.id, null);
});

test("a remembered Profile the Session has forgotten is dropped, not an error", async () => {
  const kit = build();
  kit.memory.store.set("K7M2QX9RTB", "PROFILEAAA");
  kit.api.fail = { on: "fetchProfile", error: new ApiError("not_found", "Introuvable.") };
  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });

  assert.equal(kit.status.phase, "ready", "the join screen is still perfectly usable");
  assert.equal(kit.memory.store.has("K7M2QX9RTB"), false, "the stale pick is forgotten");
});

test("a failed Session load is an error screen, not a silent empty Deck", async () => {
  const kit = build();
  kit.api.fail = { on: "fetchSession", error: new ApiError("not_found", "Session introuvable.") };
  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });

  assert.equal(kit.status.phase, "error");
  assert.equal(kit.status.message, "Session introuvable.");
});

test("navigating to another Session leaves nothing of the last one behind", async () => {
  const kit = await joined();
  kit.cache.setVerdict("female", "JEANNE", "keep");

  await kit.cache.syncFrom({ name: "home" });

  assert.equal(kit.session.id, null);
  assert.equal(kit.profile.id, null);
  assert.deepEqual(kit.profile.modes.female.verdicts, {});
});

/* ------------------------------------------------------------------- joining */

test("a refused name keeps you on the join screen rather than ending the Session", async () => {
  const kit = build();
  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });
  kit.api.fail = {
    on: "createProfile",
    error: new ApiError("conflict", "Cette session a déjà deux profils."),
  };

  const joinedOk = await kit.cache.addProfile("C");

  assert.equal(joinedOk, false);
  assert.equal(kit.joinError.message, "Cette session a déjà deux profils.");
  assert.equal(kit.status.phase, "ready", "the Session is fine — it was the request that was not");
  assert.equal(kit.session.id, "K7M2QX9RTB");
});

test("adding a Profile extends the Session list without re-fetching it", async () => {
  const kit = build();
  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });
  kit.api.nextProfile = kit.api.profile({ id: "PROFILEBBB", name: "B" });
  kit.api.calls.length = 0;

  await kit.cache.addProfile("B");

  assert.deepEqual(kit.api.calls, ["createProfile"]);
  assert.deepEqual(
    kit.session.profiles.map((p) => p.id),
    ["PROFILEAAA", "PROFILEBBB"],
  );
  assert.equal(kit.memory.store.get("K7M2QX9RTB"), "PROFILEBBB");
});

/* ------------------------------------------------------------------ verdicts */

test("a Verdict lands in memory immediately and goes out behind it", async () => {
  const kit = await joined();
  kit.cache.setVerdict("female", "JEANNE", "keep");

  assert.equal(kit.profile.modes.female.verdicts["JEANNE"], "keep");
  await kit.outbox.settled();
  assert.ok(kit.api.calls.includes("putVerdict:female:JEANNE=keep"));
});

test("clearing a Verdict sends a DELETE, returning the Prénom to the Deck unjudged", async () => {
  const kit = await joined();
  kit.cache.setVerdict("female", "JEANNE", "keep");
  await kit.outbox.settled();
  kit.cache.clearVerdict("female", "JEANNE");
  await kit.outbox.settled();

  assert.equal(kit.profile.modes.female.verdicts["JEANNE"], undefined);
  assert.ok(kit.api.calls.includes("deleteVerdict:female:JEANNE"));
});

test("a Verdict in one Mode says nothing about the other", async () => {
  const kit = await joined();
  kit.cache.setVerdict("female", "CAMILLE", "reject");
  assert.equal(kit.profile.modes.male.verdicts["CAMILLE"], undefined);
});

test("no write goes out once this Profile is ready — the server would only refuse it", async () => {
  const kit = await joined();
  kit.api.nextSession = kit.api.session({ profiles: [{ id: "PROFILEAAA", name: "A", ready: true }] });
  await kit.cache.declareReady();
  kit.api.calls.length = 0;

  kit.cache.setVerdict("female", "JEANNE", "keep");
  kit.cache.resolveDuel("female", "JEANNE", "ZOE");
  kit.clock.fire();
  await kit.outbox.settled();

  assert.deepEqual(kit.api.calls, [], "a write certain to be refused is never sent");
});

test("no write goes out once the Session has merged", async () => {
  const kit = await joined();
  kit.session.merged = true;
  kit.cache.setVerdict("female", "JEANNE", "keep");
  await kit.outbox.settled();

  assert.deepEqual(kit.api.calls, []);
});

/* ------------------------------------------------------------------- bracket */

test("a Prénom kept after the draw waits for the next one, and is not slipped in", async () => {
  const kit = await joined();
  for (const prenom of ["A", "B", "C", "D"]) kit.cache.setVerdict("female", prenom, "keep");
  kit.cache.drawBracket("female");
  assert.equal(kit.cache.bracketOf("female").field.length, 4);

  kit.cache.setVerdict("female", "E", "keep");
  assert.equal(kit.cache.bracketOf("female").field.length, 4, "the draw is not touched");
  assert.equal(kit.cache.bracketIsStale("female"), true, "but the screen may offer a redraw");

  kit.cache.drawBracket("female");
  assert.equal(kit.cache.bracketOf("female").field.length, 5);
  assert.equal(kit.cache.bracketIsStale("female"), false);
});

test("a Prénom that loses its keep Verdict withdraws, and its opponent advances", async () => {
  const kit = await joined();
  for (const prenom of ["A", "B"]) kit.cache.setVerdict("female", prenom, "keep");
  kit.cache.drawBracket("female");
  assert.notEqual(kit.cache.duelFor("female"), null, "two Prénoms is one Duel");

  kit.cache.clearVerdict("female", "A");
  assert.equal(kit.cache.duelFor("female"), null, "a bye is not a question worth asking");
  assert.deepEqual(kit.cache.bracketOf("female").places, ["B"], "B takes the Place unopposed");
});

test("a Duel the tree is not waiting on is refused rather than guessed at", async () => {
  const kit = await joined();
  for (const prenom of ["A", "B"]) kit.cache.setVerdict("female", prenom, "keep");
  kit.cache.drawBracket("female");
  kit.cache.resolveDuel("female", "A", "B");
  const played = kit.cache.bracketOf("female").played;

  kit.cache.resolveDuel("female", "B", "A");
  assert.equal(kit.cache.bracketOf("female").played, played, "the stale answer is dropped");
});

test("hydrating a Profile that is already consistent queues no write back", async () => {
  const kit = build();
  kit.memory.store.set("K7M2QX9RTB", "PROFILEAAA");
  kit.api.nextProfile = kit.api.profile({
    modes: {
      male: kit.api.mode(),
      female: kit.api.mode({ verdicts: { JEANNE: "keep" } }),
    },
  });

  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });
  kit.clock.fire();
  await kit.outbox.settled();

  assert.equal(kit.clock.count, 0);
  assert.deepEqual(kit.api.calls, ["fetchSession", "fetchProfile"]);
});

test("a run of Duels coalesces into one write, not one per tap", async () => {
  const kit = await joined();
  for (const prenom of ["A", "B", "C", "D"]) kit.cache.setVerdict("female", prenom, "keep");
  kit.cache.drawBracket("female");
  kit.api.calls.length = 0;

  // Whatever the draw asks, three times over — the point is the request count.
  for (let tap = 0; tap < 3; tap++) {
    const duel = kit.cache.duelFor("female")!;
    kit.cache.resolveDuel("female", duel[0], duel[1]);
  }
  assert.equal(kit.api.calls.length, 0, "nothing goes out mid-run");

  kit.clock.fire();
  await kit.outbox.settled();
  assert.equal(kit.api.calls.filter((c) => c.startsWith("putBracket")).length, 1);
});

test("the shared tablet: a Bracket owed is addressed to the Profile that played it", async () => {
  const kit = await joined();
  kit.cache.setVerdict("female", "A", "keep");
  kit.cache.setVerdict("female", "B", "keep");
  kit.cache.drawBracket("female");
  kit.cache.resolveDuel("female", "A", "B");
  kit.api.calls.length = 0;

  // The tablet changes hands before the debounce elapses.
  kit.api.nextProfile = kit.api.profile({ id: "PROFILEBBB", name: "B" });
  await kit.cache.claimProfile("PROFILEBBB");
  await kit.outbox.settled();

  const written = kit.api.calls.filter((c) => c.startsWith("putBracket"));
  assert.equal(written.length, 1, "the outgoing Profile's Duels are not dropped");
  assert.ok(
    written[0]!.startsWith("putBracket:PROFILEAAA:"),
    `A's Duels must not land on B's Profile, got ${written[0]}`,
  );
});

test("flush cuts the debounce short, so a closing tab does not lose the last Duels", async () => {
  const kit = await joined();
  kit.cache.setVerdict("female", "A", "keep");
  kit.cache.setVerdict("female", "B", "keep");
  kit.cache.drawBracket("female");
  kit.cache.resolveDuel("female", "A", "B");
  kit.api.calls.length = 0;

  kit.cache.flush();
  await kit.outbox.settled();

  assert.equal(kit.api.calls.filter((c) => c.startsWith("putBracket")).length, 1);
});

test("going ready drains what is owed before the Session can merge under it", async () => {
  const kit = await joined();
  kit.cache.setVerdict("female", "A", "keep");
  kit.cache.setVerdict("female", "B", "keep");
  kit.cache.drawBracket("female");
  kit.cache.resolveDuel("female", "A", "B");
  kit.api.calls.length = 0;

  await kit.cache.declareReady();

  const written = kit.api.calls.findIndex((c) => c.startsWith("putBracket"));
  const ready = kit.api.calls.indexOf("declareReady");
  assert.ok(written !== -1, "the last Duels go out");
  assert.ok(written < ready, "and they go out before the merge, or they would be refused");
});

/* ----------------------------------------------------------------- the Nom */

test("the Nom is debounced, and blank means none", async () => {
  const kit = await joined();
  kit.cache.setNom("Mar");
  kit.cache.setNom("Mart");
  kit.cache.setNom("Martin");
  assert.equal(kit.session.nom, "Martin", "the input reads it back immediately");
  assert.deepEqual(kit.api.calls, []);

  kit.clock.fire();
  await kit.outbox.settled();
  assert.deepEqual(kit.api.calls, ["putNom"], "one write for the whole word");

  kit.cache.setNom("   ");
  assert.equal(kit.session.nom, null);
});

test("the Nom outlives being ready — it is the Session's, not a Profile's", async () => {
  const kit = await joined();
  kit.api.nextSession = kit.api.session({ profiles: [{ id: "PROFILEAAA", name: "A", ready: true }] });
  await kit.cache.declareReady();
  kit.api.calls.length = 0;

  kit.cache.setNom("Martin");
  kit.clock.fire();
  await kit.outbox.settled();

  assert.deepEqual(kit.api.calls, ["putNom"]);
});

/* --------------------------------------------------------- the Final Profile */

test("a Final Profile Duel sends the fact and takes the tree back from the server", async () => {
  const kit = build();
  const drawn = drawBracket(["JEANNE", "ZOE"]);
  kit.api.nextSession = kit.api.session({
    merged: true,
    final: { modes: { male: { bracket: emptyBracket() }, female: { bracket: drawn } } },
  });
  kit.api.nextFinal = {
    modes: {
      male: { bracket: emptyBracket() },
      female: { bracket: resolveBracket(drawn, "JEANNE", "ZOE")! },
    },
  };
  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });
  kit.api.calls.length = 0;

  kit.cache.resolveFinalDuel("female", "JEANNE", "ZOE");
  await kit.cache.finalDuelsSettled();

  assert.deepEqual(kit.api.calls, ["postFinalDuel:female:JEANNE>ZOE"]);
  assert.deepEqual(
    kit.session.final!.modes.female.bracket.places,
    ["JEANNE", "ZOE"],
    "the Places are the server's, never resolved here",
  );
});

test("a lost Final Profile Duel is said out loud, never retried", async () => {
  const kit = build();
  kit.api.nextSession = kit.api.session({
    merged: true,
    final: {
      modes: { male: { bracket: emptyBracket() }, female: { bracket: drawBracket(["JEANNE", "ZOE"]) } },
    },
  });
  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });
  kit.api.calls.length = 0;
  kit.api.fail = {
    on: "postFinalDuel:female:JEANNE>ZOE",
    error: new ApiError("network", "Connexion perdue."),
  };

  kit.cache.resolveFinalDuel("female", "JEANNE", "ZOE");
  await kit.cache.finalDuelsSettled();

  assert.equal(kit.api.calls.length, 1, "a Duel counted twice is worse than one openly lost");
  assert.equal(kit.connection.refused, "Connexion perdue.");
});

test("Final Profile Duels are answered in the order they were played", async () => {
  const kit = build();
  kit.api.nextSession = kit.api.session({
    merged: true,
    final: { modes: { male: { bracket: emptyBracket() }, female: { bracket: drawBracket(["A", "B"]) } } },
  });
  await kit.cache.syncFrom({ name: "session", id: "K7M2QX9RTB" });
  kit.api.calls.length = 0;

  kit.cache.resolveFinalDuel("female", "A", "B");
  kit.cache.resolveFinalDuel("female", "B", "A");
  await kit.cache.finalDuelsSettled();

  assert.deepEqual(kit.api.calls, ["postFinalDuel:female:A>B", "postFinalDuel:female:B>A"]);
});

/* ---------------------------------------------------------------- the banner */

test("a terminal refusal reaches the banner and stays up", async () => {
  const kit = await joined();
  kit.api.fail = { on: "putVerdict:female:JEANNE=keep", error: new ApiError("conflict", "La session a fusionné.") };

  kit.cache.setVerdict("female", "JEANNE", "keep");
  await kit.outbox.settled();

  assert.equal(kit.connection.refused, "La session a fusionné.");
});
