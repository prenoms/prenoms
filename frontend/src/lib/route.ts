/**
 * Where the app is, read off the path. The Session id is in the path and not in
 * the hash — `/s/K7M2QX9RTB#/swipe` — so the link a parent sends is a real URL
 * that survives a cold visit through the SPA fallback (ADR 0003, root.htaccess).
 * The view stays in the hash, because it is nobody's business but this tab's.
 *
 * Pure and no runes: the reactive half lives in `state.svelte.ts`, and this is
 * the part worth testing.
 */

import { ID_ALPHABET, ID_PATTERN, normaliseId } from "./api";

export type Route = { name: "home" } | { name: "session"; id: string };

/** Deliberately loose: what makes a segment an id is `ID_PATTERN`, not this. */
const PATH = /^\/s\/([^/]+)\/?$/;

/** Anything that is not a Session is the homepage — there are only two screens. */
export function parseRoute(pathname: string): Route {
  const id = normaliseId(PATH.exec(pathname)?.[1] ?? "");
  // The alphabet check is the same one the server applies before the id becomes
  // a filename; failing it here means the link was mistyped, not that a Session
  // is missing, and the homepage says so better than a 404 would.
  return ID_PATTERN.test(id) ? { name: "session", id } : { name: "home" };
}

export function sessionPath(id: string): string {
  return `/s/${id}`;
}

/**
 * What the join box accepts: an id read aloud over the phone, or the whole link
 * pasted out of a message — which is what people actually do. Never a guess: an
 * input we cannot read an id out of is refused, so a typo does not become a
 * request for a Session that never existed.
 */
export function idFromInput(raw: string): string | null {
  const text = normaliseId(raw);
  if (ID_PATTERN.test(text)) return text;
  const match = new RegExp(`/S/([${ID_ALPHABET}]{10})(?![${ID_ALPHABET}])`).exec(text);
  return match?.[1] ?? null;
}
