<script lang="ts">
  import { choosePair, isProvisional, type Contender, type Pair } from "../lib/duel";
  import {
    deck,
    duelsOf,
    profile,
    ratingOf,
    resolveDuel,
    session,
    setView,
    ui,
  } from "../lib/state.svelte";

  const mode = $derived(profile.modes[ui.mode]);

  /** The Shortlist, with each Prénom's Rating and Duel count. All derived. */
  const contenders = $derived<Contender[]>(
    deck.current
      .filter((p) => mode.verdicts[p.prenom] === "keep")
      .map((p) => ({
        prenom: p.prenom,
        rating: ratingOf(p.prenom),
        duels: duelsOf(p.prenom),
      })),
  );

  /** The Shortlist ordered by Rating. Readable at any time, never final. */
  const ranking = $derived(contenders.slice().sort((a, b) => b.rating - a.rating));

  const duelsPlayed = $derived(contenders.reduce((total, c) => total + c.duels, 0) / 2);

  let pair = $state<Pair | null>(null);
  let showRanking = $state(false);

  /**
   * Pairing is deliberately not derived: a Duel must not re-roll when a Rating
   * changes underneath it. It is picked once, then again after each Duel.
   */
  function nextPair(avoid: Pair | null = null) {
    pair = choosePair(contenders, Math.random, avoid);
  }

  $effect(() => {
    // Re-pair when the Shortlist itself changes shape, not when Ratings move.
    const size = contenders.length;
    if (size < 2) pair = null;
    else if (pair === null || pair.some((p) => !contenders.some((c) => c.prenom === p))) nextPair();
  });

  function pick(winner: string) {
    if (!pair) return;
    const loser = pair[0] === winner ? pair[1] : pair[0];
    resolveDuel(winner, loser);
    nextPair(pair);
  }

  const provisional = $derived(new Set(contenders.filter(isProvisional).map((c) => c.prenom)));
</script>

<div class="game">
  {#if contenders.length < 2}
    <div class="empty">
      <h2>Il faut au moins deux Prénoms.</h2>
      <p>
        Votre Shortlist en compte {contenders.length}. Gardez-en d'autres, puis revenez les
        départager.
      </p>
      <button class="cta" onclick={() => setView("swipe")}>Passer des Cartes</button>
      <button class="cta ghost" onclick={() => setView("browse")}>Parcourir le Deck</button>
    </div>
  {:else}
    <div class="head">
      <p class="tally">
        {duelsPlayed} duel{duelsPlayed > 1 ? "s" : ""} · Shortlist {contenders.length}
      </p>
      <button class="toggle" onclick={() => (showRanking = !showRanking)}>
        {showRanking ? "Revenir aux duels" : "Voir le classement"}
      </button>
    </div>

    {#if showRanking}
      <ol class="ranking">
        {#each ranking as { prenom, rating } (prenom)}
          <li>
            <span class="place"></span>
            <span class="prenom"
              >{prenom}{#if session.nom}&nbsp;<span class="nom">{session.nom}</span>{/if}</span
            >
            {#if provisional.has(prenom)}<span class="badge">à confirmer</span>{/if}
            <span class="rating">{Math.round(rating)}</span>
          </li>
        {/each}
      </ol>
    {:else if pair}
      <p class="prompt">Lequel préférez-vous ?</p>
      <div class="duel">
        {#each pair as prenom (prenom)}
          <button class="contender" onclick={() => pick(prenom)}>
            <span class="prenom">{prenom}</span>
            {#if session.nom}<span class="nom">{session.nom}</span>{/if}
            {#if provisional.has(prenom)}<span class="badge">à confirmer</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .game {
    max-width: 32rem;
    margin: 0 auto;
    padding: 1rem 1.25rem 3rem;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .tally {
    margin: 0;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .toggle {
    margin-left: auto;
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 999px;
    padding: 0.3rem 0.85rem;
    font-size: 0.8rem;
    color: var(--ink-soft);
  }

  .prompt {
    text-align: center;
    color: var(--ink-soft);
    margin: 1.5rem 0 1rem;
  }

  .duel {
    display: grid;
    gap: 0.75rem;
  }

  .contender {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-height: 8.5rem;
    border: 1px solid var(--line);
    border-radius: 1.25rem;
    background: #fff;
    padding: 1rem;
  }

  .contender:hover {
    border-color: var(--accent);
  }

  .contender .prenom {
    font-size: clamp(1.75rem, 9vw, 2.5rem);
    line-height: 1.1;
  }

  .nom {
    color: var(--ink-soft);
  }

  .badge {
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
  }

  .ranking {
    list-style: none;
    counter-reset: place;
    padding: 0;
    margin: 1.25rem 0 0;
  }

  .ranking li {
    counter-increment: place;
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--line);
  }

  .place::before {
    content: counter(place);
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft);
    font-size: 0.85rem;
  }

  .ranking .prenom {
    font-size: 1.2rem;
  }

  .rating {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }

  .empty h2 {
    font-size: 1.4rem;
    margin: 2rem 0 0.5rem;
  }

  .empty p {
    color: var(--ink-soft);
  }

  .cta {
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--paper);
    padding: 0.55rem 1.1rem;
    margin-right: 0.6rem;
  }

  .cta.ghost {
    background: none;
    border: 1px solid var(--line);
    color: var(--ink-soft);
  }
</style>
