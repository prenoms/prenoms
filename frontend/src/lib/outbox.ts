/**
 * The write-through half of the cache. A swipe lands in memory immediately and
 * the request goes out behind it; this is what carries it, and what admits
 * failure out loud when it cannot.
 *
 * This is **not** the offline queue ADR 0003 rejected. That one would have had
 * to be persisted, and persistence is the thing we removed; this holds at most
 * one write per key, lives in memory and dies with the tab. A connection that
 * stays broken until the tab closes therefore loses the swipes made in the
 * meantime, and the only honest thing left is to say so out loud — hence
 * `failing`, which the banner reads.
 *
 * Plain TypeScript, no runes: the state module wraps it in `$state`.
 */

import { ApiError } from "./api";

/** One write, already bound to its ids and its payload. */
export type Attempt = () => Promise<void>;

type Slot = {
  /** The latest write for this key, not yet sent. */
  queued: Attempt | null;
  running: boolean;
  failures: number;
};

const FIRST_BACKOFF = 500;
const MAX_BACKOFF = 30_000;

export type OutboxOptions = {
  /** Injected so the tests settle immediately instead of waiting seconds. */
  delay?: (ms: number) => Promise<void>;
};

export class Outbox {
  /**
   * Keyed by what the write is about — `verdict:female:Jeanne`, `ratings:male`.
   * Two writes with the same key are the same fact stated twice, so the later
   * one replaces the earlier: starring and un-starring in quick succession
   * sends one request, not two, and Verdict writes are idempotent anyway.
   */
  readonly #slots = new Map<string, Slot>();
  readonly #delay: (ms: number) => Promise<void>;
  readonly #changed: (() => void)[] = [];
  readonly #refused: ((error: ApiError) => void)[] = [];
  #inFlight = 0;
  #idle: (() => void)[] = [];

  constructor(options: OutboxOptions = {}) {
    this.#delay = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Writes still owed to the server. Zero means everything is safe to close on. */
  get pending(): number {
    let count = 0;
    for (const slot of this.#slots.values()) {
      if (slot.queued !== null || slot.running) count += 1;
    }
    return count;
  }

  /** True while at least one write is being retried — the banner's only input. */
  get failing(): boolean {
    for (const slot of this.#slots.values()) {
      if (slot.failures > 0) return true;
    }
    return false;
  }

  onChange(listener: () => void): void {
    this.#changed.push(listener);
  }

  /** A refusal the server will never accept: shown once, then forgotten. */
  onError(listener: (error: ApiError) => void): void {
    this.#refused.push(listener);
  }

  backoffFor(failures: number): number {
    return Math.min(FIRST_BACKOFF * 2 ** (failures - 1), MAX_BACKOFF);
  }

  schedule(key: string, attempt: Attempt): void {
    let slot = this.#slots.get(key);
    if (slot === undefined) {
      slot = { queued: null, running: false, failures: 0 };
      this.#slots.set(key, slot);
    }
    slot.queued = attempt;
    this.#announce();
    if (!slot.running) void this.#drain(key, slot);
  }

  /** Resolves once nothing is owed. Used by the tests. */
  settled(): Promise<void> {
    if (this.#inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  async #drain(key: string, slot: Slot): Promise<void> {
    slot.running = true;
    this.#inFlight += 1;

    while (slot.queued !== null) {
      const attempt = slot.queued;
      slot.queued = null;
      try {
        await attempt();
        slot.failures = 0;
      } catch (error) {
        const failure =
          error instanceof ApiError
            ? error
            : new ApiError("network", "Connexion perdue. Vos choix ne sont plus enregistrés.");

        if (!failure.retryable) {
          // The server has ruled: the Session has merged, or this Profile is
          // ready. Retrying would keep the banner up over a settled refusal.
          slot.failures = 0;
          for (const listener of this.#refused) listener(failure);
          continue;
        }

        slot.failures += 1;
        this.#announce();
        await this.#delay(this.backoffFor(slot.failures));
        // A newer write for this key arrived while we waited: it supersedes.
        if (slot.queued === null) slot.queued = attempt;
      }
      this.#announce();
    }

    slot.running = false;
    this.#slots.delete(key);
    this.#inFlight -= 1;
    this.#announce();
    if (this.#inFlight === 0) {
      const waiting = this.#idle;
      this.#idle = [];
      for (const resolve of waiting) resolve();
    }
  }

  #announce(): void {
    for (const listener of this.#changed) listener();
  }
}
