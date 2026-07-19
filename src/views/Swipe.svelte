<script lang="ts">
  import type { Verdict } from "../lib/domain";
  import { seededShuffle } from "../lib/shuffle";
  import { clearVerdict, deck, persisted, session, setVerdict, setView } from "../lib/state.svelte";

  const SWIPE_THRESHOLD = 90;
  const UNDO_DEPTH = 10;

  const mode = $derived(persisted.modes[session.mode]);

  /** Stable across sessions: same seed, same Deck order. */
  const shuffled = $derived(seededShuffle(deck.current, mode.seed));

  /** The Deck minus anything already judged — starring in Browse removes it too. */
  const queue = $derived(shuffled.filter((p) => mode.verdicts[p.prenom] === undefined));

  const card = $derived(queue[0]);
  const next = $derived(queue[1]);
  const seen = $derived(deck.current.length - queue.length);

  const shortlist = $derived(deck.current.filter((p) => mode.verdicts[p.prenom] === "keep"));

  /** Undo stack, session-only: a reload starts you where you left off, not mid-history. */
  let undoStack = $state<string[]>([]);

  let dx = $state(0);
  let dragging = $state(false);
  let pointerStart = 0;

  /** Which way the outgoing card should fly. */
  let lastDirection = $state<1 | -1>(1);

  const tilt = $derived(dx / 18);
  const intent = $derived<Verdict | null>(
    dx > SWIPE_THRESHOLD ? "keep" : dx < -SWIPE_THRESHOLD ? "reject" : null,
  );

  function judge(verdict: Verdict) {
    if (!card) return;
    lastDirection = verdict === "keep" ? 1 : -1;
    undoStack = [card.prenom, ...undoStack].slice(0, UNDO_DEPTH);
    setVerdict(card.prenom, verdict);
    dx = 0;
    dragging = false;
  }

  /**
   * Steps back one card and clears its Verdict. Because the queue is derived
   * from the stable shuffle, the Prénom reappears exactly where it was.
   */
  function undo() {
    const [previous, ...rest] = undoStack;
    if (previous === undefined) return;
    undoStack = rest;
    clearVerdict(previous);
    dx = 0;
  }

  function onpointerdown(event: PointerEvent) {
    if (!card) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointerStart = event.clientX;
    dragging = true;
  }

  function onpointermove(event: PointerEvent) {
    if (dragging) dx = event.clientX - pointerStart;
  }

  function onpointerup() {
    if (!dragging) return;
    if (intent) judge(intent);
    else {
      dx = 0;
      dragging = false;
    }
  }

  /** Flies the judged card off the side it was sent to. */
  function fly(_node: Element, { direction }: { direction: 1 | -1 }) {
    return {
      duration: 260,
      css: (t: number, u: number) =>
        `transform: translateX(${direction * u * 140}%) rotate(${direction * u * 20}deg); opacity: ${t};`,
    };
  }
</script>

<div class="swipe">
  {#if card}
    <p class="tally">{queue.length} restants · {seen} jugés · Shortlist {shortlist.length}</p>

    <div class="stage">
      {#if next}
        <div class="card behind" aria-hidden="true"><span class="prenom">{next.prenom}</span></div>
      {/if}

      {#key card.prenom}
        <div
          class="card"
          class:dragging
          role="group"
          aria-label="Prénom {card.prenom}"
          style:transform="translateX({dx}px) rotate({tilt}deg)"
          out:fly={{ direction: lastDirection }}
          {onpointerdown}
          {onpointermove}
          {onpointerup}
          onpointercancel={onpointerup}
        >
          <span class="prenom">{card.prenom}</span>
          {#if persisted.nom}<span class="nom">{persisted.nom}</span>{/if}

          <span class="stamp keep" class:visible={intent === "keep"}>Gardé</span>
          <span class="stamp reject" class:visible={intent === "reject"}>Rejeté</span>
        </div>
      {/key}
    </div>

    <div class="actions">
      <button class="reject" onclick={() => judge("reject")} aria-label="Rejeter {card.prenom}">
        <svg viewBox="0 0 24 24" aria-hidden="true"
          ><path d="M6 6 L18 18 M18 6 L6 18" /></svg
        >
      </button>
      <button class="undo" onclick={undo} disabled={undoStack.length === 0}>Annuler</button>
      <button class="keep" onclick={() => judge("keep")} aria-label="Garder {card.prenom}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13 L10 18 L19 7" /></svg>
      </button>
    </div>
  {:else}
    <div class="end">
      <h2>Vous les avez tous vus.</h2>
      {#if shortlist.length === 0}
        <p>Aucun Prénom gardé dans ce Deck. Repassez par Parcourir si vous avez été trop dur.</p>
      {:else}
        <p>Votre Shortlist — {shortlist.length} Prénom{shortlist.length > 1 ? "s" : ""} :</p>
        <ul>
          {#each shortlist as { prenom } (prenom)}
            <li>{prenom}{#if persisted.nom}&nbsp;<span class="nom">{persisted.nom}</span>{/if}</li>
          {/each}
        </ul>
        {#if shortlist.length >= 2}
          <button class="cta" onclick={() => setView("game")}>Les classer en Duels</button>
        {/if}
      {/if}
      {#if undoStack.length > 0}
        <button class="undo" onclick={undo}>Annuler le dernier</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .swipe {
    max-width: 32rem;
    margin: 0 auto;
    padding: 1rem 1.25rem 2rem;
  }

  .tally {
    margin: 0 0 1rem;
    text-align: center;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .stage {
    position: relative;
    height: 20rem;
  }

  .card {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    border: 1px solid var(--line);
    border-radius: 1.25rem;
    background: #fff;
    box-shadow: 0 12px 30px -18px rgba(0, 0, 0, 0.4);
    touch-action: none;
    user-select: none;
    cursor: grab;
    transition: transform 180ms ease;
  }

  .card.dragging {
    transition: none;
    cursor: grabbing;
  }

  .card.behind {
    transform: scale(0.94) translateY(0.75rem);
    opacity: 0.5;
    box-shadow: none;
  }

  .prenom {
    font-size: clamp(2.25rem, 12vw, 3.5rem);
    line-height: 1.05;
    text-align: center;
  }

  .nom {
    font-size: 1.25rem;
    color: var(--ink-soft);
  }

  .stamp {
    position: absolute;
    top: 1.25rem;
    padding: 0.2rem 0.7rem;
    border: 2px solid currentColor;
    border-radius: 0.4rem;
    font-size: 0.85rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .stamp.visible {
    opacity: 1;
  }

  .stamp.keep {
    left: 1.25rem;
    color: var(--keep);
    transform: rotate(-8deg);
  }

  .stamp.reject {
    right: 1.25rem;
    color: var(--reject);
    transform: rotate(8deg);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    margin-top: 1.75rem;
  }

  .actions button {
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 999px;
  }

  .actions .reject,
  .actions .keep {
    display: grid;
    place-items: center;
    width: 3.75rem;
    height: 3.75rem;
    padding: 0;
  }

  .actions svg {
    width: 1.6rem;
    height: 1.6rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .actions .reject {
    color: var(--reject);
    border-color: color-mix(in srgb, var(--reject) 35%, var(--line));
  }

  .actions .keep {
    color: var(--keep);
    border-color: color-mix(in srgb, var(--keep) 35%, var(--line));
  }

  .actions .reject:hover {
    background: color-mix(in srgb, var(--reject) 8%, #fff);
  }

  .actions .keep:hover {
    background: color-mix(in srgb, var(--keep) 8%, #fff);
  }

  .undo {
    padding: 0.45rem 1rem;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }

  .undo:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .end h2 {
    font-size: 1.5rem;
    margin: 2rem 0 0.5rem;
  }

  .end p {
    color: var(--ink-soft);
  }

  .end ul {
    list-style: none;
    padding: 0;
    margin: 1rem 0;
    font-size: 1.3rem;
    line-height: 1.6;
  }

  .cta {
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--paper);
    padding: 0.6rem 1.2rem;
    margin-right: 0.75rem;
  }
</style>
