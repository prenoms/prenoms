/**
 * The Session API, one function per endpoint (`../../../backend/README.md`). Plain
 * `fetch` and no reactivity: the state module owns the cache, this owns the
 * wire. Authorisation is possession of the Session id and nothing else, so
 * there is nothing to attach to a request beyond the ids in the path.
 */

import type { Mode, Verdict } from "./domain";
import type { BracketState } from "./bracket";

/** The server's `error` field, plus the one failure it cannot report itself. */
export type ErrorCode = "bad_request" | "not_found" | "conflict" | "server_error" | "network";

export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }

  /**
   * Whether trying again could ever work. A dropped connection or a stumbling
   * server might; a `409` after the Profile declared itself ready never will,
   * and retrying it forever would keep the banner up over a settled refusal.
   */
  get retryable(): boolean {
    return this.code === "network" || this.code === "server_error";
  }
}

const GENERIC: Record<ErrorCode, string> = {
  bad_request: "Requête invalide.",
  not_found: "Session ou profil introuvable.",
  conflict: "Action impossible dans l'état actuel de la session.",
  server_error: "Erreur du serveur. Réessayez dans un instant.",
  network: "Connexion perdue. Vos choix ne sont plus enregistrés.",
};

function codeFor(status: number): ErrorCode {
  if (status === 400) return "bad_request";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "server_error";
}

/**
 * How long a write may hang before we call it lost. A captive portal answers
 * the TCP handshake and then nothing, so without this the promise never settles,
 * the banner never goes up, and the user swipes into a void — the exact silent
 * failure ADR 0003 forbids. A timeout turns the hang into a retryable failure.
 */
const TIMEOUT = 12_000;

/**
 * One request. Errors always arrive as an `ApiError` carrying a French message
 * fit to put in front of a user — the server sends one, and the cases it cannot
 * answer at all (a dead connection, a proxy returning HTML) get one here.
 *
 * `fetch` is a parameter so the mapping can be tested without a server.
 */
export async function request(
  path: string,
  init: RequestInit = {},
  send: typeof fetch = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await send(path, {
      signal: AbortSignal.timeout(TIMEOUT),
      ...init,
      headers: init.body === undefined ? init.headers : { "content-type": "application/json" },
    });
  } catch {
    throw new ApiError("network", GENERIC.network);
  }

  // 204 on every write that has nothing to say back; parsing it would throw.
  const body = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const failure = (body ?? {}) as { error?: string; message?: string };
    const code = codeFor(response.status);
    throw new ApiError(code, failure.message ?? GENERIC[code]);
  }

  return body;
}

/** Ids are Crockford base32, case-insensitive on input and uppercase everywhere else. */
export function normaliseId(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Crockford base32 — no I, L, O or U, so nothing is misread aloud. Exported
 * because the router needs the same alphabet, and one id rule spelled twice is
 * one id rule that will eventually disagree with itself.
 */
export const ID_ALPHABET = "0-9ABCDEFGHJKMNPQRSTVWXYZ";

export const ID_PATTERN = new RegExp(`^[${ID_ALPHABET}]{10}$`);

export type ModeState = {
  /** Drives the stable Deck shuffle in Cartes. */
  seed: number;
  /** Keyed by the Prénom string — never a row index, the CSV is hand-edited. */
  verdicts: Record<string, Verdict>;
  /** The tournament over the Shortlist, and the Places it has awarded. */
  bracket: BracketState;
};

/** A Profile's own state. Returned only to whoever asked for it by id. */
export type ProfileState = {
  id: string;
  name: string;
  ready: boolean;
  modes: Record<Mode, ModeState>;
};

/** What the Session will say about a Profile to anyone holding the link. */
export type ProfileSummary = { id: string; name: string; ready: boolean };

/** The Final Profile: one Bracket per Mode, played by both parents, no Verdicts. */
export type FinalState = { modes: Record<Mode, { bracket: BracketState }> };

/**
 * The Session as the join screen may see it. Never another Profile's Verdicts —
 * seeing their Shortlist while you are still swiping would make the final Duels
 * theatre (ADR 0003).
 */
export type SessionState = {
  id: string;
  nom: string | null;
  merged: boolean;
  profiles: ProfileSummary[];
  final: FinalState | null;
};

const base = "/api/sessions";

function json(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}

export async function createSession(): Promise<SessionState> {
  return (await request(base, { method: "POST" })) as SessionState;
}

export async function fetchSession(id: string): Promise<SessionState> {
  return (await request(`${base}/${id}`)) as SessionState;
}

export async function fetchProfile(id: string, profileId: string): Promise<ProfileState> {
  return (await request(`${base}/${id}/profiles/${profileId}`)) as ProfileState;
}

/** Session-level: one Nom, shared by both Profiles and both Modes, either may set it. */
export async function putNom(id: string, nom: string | null): Promise<SessionState> {
  return (await request(`${base}/${id}/nom`, { method: "PUT", ...json({ nom: nom ?? "" }) })) as SessionState;
}

export async function createProfile(id: string, name: string): Promise<ProfileState> {
  return (await request(`${base}/${id}/profiles`, { method: "POST", ...json({ name }) })) as ProfileState;
}

/** Idempotent, keyed by (Profile, Mode, Prénom) — which is what makes a retry free. */
export async function putVerdict(
  id: string,
  profileId: string,
  mode: Mode,
  prenom: string,
  verdict: Verdict,
): Promise<void> {
  await request(`${base}/${id}/profiles/${profileId}/verdicts/${mode}/${encodeURIComponent(prenom)}`, {
    method: "PUT",
    ...json({ verdict }),
  });
}

export async function deleteVerdict(
  id: string,
  profileId: string,
  mode: Mode,
  prenom: string,
): Promise<void> {
  await request(`${base}/${id}/profiles/${profileId}/verdicts/${mode}/${encodeURIComponent(prenom)}`, {
    method: "DELETE",
  });
}

/**
 * One Mode's Bracket, written whole. `bracket.ts` owns the rules for the
 * per-Profile phase; the server only stores the state.
 */
export async function putBracket(
  id: string,
  profileId: string,
  mode: Mode,
  bracket: BracketState,
): Promise<void> {
  await request(`${base}/${id}/profiles/${profileId}/bracket/${mode}`, {
    method: "PUT",
    // `keepalive` so the flush on pagehide actually leaves: a tab being unloaded
    // has its ordinary fetches cancelled, which would drop the last Duels of a
    // session in silence. One Shortlist's tree is far inside the 64 KB limit.
    keepalive: true,
    ...json({ bracket }),
  });
}

/** Irreversible, and it merges the Session if every Profile is then ready. */
export async function declareReady(id: string, profileId: string): Promise<SessionState> {
  return (await request(`${base}/${id}/profiles/${profileId}/ready`, { method: "POST" })) as SessionState;
}

/**
 * A Final Profile Duel. What it settles is the server's, worked out inside the
 * lock, so two parents picking at the same moment both count (ADR 0003). Never
 * resolve it here.
 */
export async function postFinalDuel(
  id: string,
  mode: Mode,
  winner: string,
  loser: string,
): Promise<FinalState> {
  return (await request(`${base}/${id}/final/duels`, {
    method: "POST",
    ...json({ mode, winner, loser }),
  })) as FinalState;
}
