<script lang="ts">
  import type { Contender } from "../lib/duel";
  import DuelBoard from "../components/DuelBoard.svelte";
  import Ranking from "../components/Ranking.svelte";
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

  const duelsPlayed = $derived(contenders.reduce((total, c) => total + c.duels, 0) / 2);

  let showRanking = $state(false);
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
      <Ranking {contenders} nom={session.nom} />
    {:else}
      <!-- Per-Profile: `duel.ts` owns this maths and only one person writes
           these Ratings, so the pick is resolved here and stored. -->
      <DuelBoard {contenders} nom={session.nom} onpick={resolveDuel} />
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
