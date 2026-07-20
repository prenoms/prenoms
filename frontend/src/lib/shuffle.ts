/**
 * A seeded shuffle, so the swipe Deck comes back in the same order after a
 * reload. The seed is persisted per Mode; the order itself never is.
 */

/** mulberry32 — small, fast, good enough to shuffle a few thousand Prénoms. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, returning a new array — the source Deck stays alphabetical. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const next = random(seed);
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}
