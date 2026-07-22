<script lang="ts">
  import { duelsLeft, isDecided, placesWanted, TOP_PLACES } from "../lib/bracket";
  import DuelBoard from "../components/DuelBoard.svelte";
  import Ranking from "../components/Ranking.svelte";
  import {
    bracketIsStale,
    bracketOf,
    drawBracket,
    duelFor,
    profile,
    resolveDuel,
    session,
    setView,
    ui,
  } from "../lib/state.svelte";

  /**
   * The per-Profile tournament. The Shortlist is the field; the Bracket is a
   * draw over it, and it is only ever drawn on purpose — starring a Prénom
   * while a tournament is under way offers a fresh draw rather than quietly
   * restarting the one being played.
   */
  const shortlist = $derived(
    Object.keys(profile.modes[ui.mode].verdicts).filter(
      (prenom) => profile.modes[ui.mode].verdicts[prenom] === "keep",
    ),
  );
  const bracket = $derived(bracketOf(ui.mode));
  const duel = $derived(duelFor(ui.mode));
  const left = $derived(duelsLeft(bracket));
  const stale = $derived(bracketIsStale(ui.mode));
  const drawn = $derived(bracket.field.length > 0);

  let showRanking = $state(false);
</script>



<div class="game">
  {#if shortlist.length < 2}
    <div class="empty">
      <h2>Il faut au moins deux Prénoms.</h2>
      <p>
        Votre Shortlist en compte {shortlist.length}. Gardez-en d'autres, puis revenez les
        départager.
      </p>
      <button class="cta" onclick={() => setView("swipe")}>Passer des Cartes</button>
      <button class="cta ghost" onclick={() => setView("browse")}>Parcourir le Deck</button>
    </div>
  {:else}
    <div class="head">
      <p class="tally">
        {bracket.played} duel{bracket.played > 1 ? "s" : ""} · Shortlist {shortlist.length}
        {#if drawn && left > 0}· encore {left} au plus{/if}
      </p>
      <button class="toggle" onclick={() => (showRanking = !showRanking)}>
        {showRanking ? "Revenir aux duels" : "Voir le classement"}
      </button>
    </div>

    {#if !drawn}
      <p class="done">
        {shortlist.length} Prénoms gardés. Le tirage décide qui affronte qui, puis vous jouez le
        tournoi jusqu'au Top {Math.min(TOP_PLACES, shortlist.length)}.
      </p>
      <button class="cta" onclick={() => drawBracket(ui.mode)}>Lancer le tournoi</button>
    {:else if showRanking || duel === null}
      {#if isDecided(bracket) && !showRanking}
        <p class="done">
          Votre Top {placesWanted(bracket)} est fait. Il n'y a plus de duel à jouer.
        </p>
      {/if}
      <Ranking {bracket} nom={session.nom} />
    {:else}
      <!-- Per-Profile: `bracket.ts` owns the rules and only one person plays
           this tournament, so the pick is resolved here and stored. -->
      <DuelBoard {duel} nom={session.nom} onpick={(winner, loser) => resolveDuel(ui.mode, winner, loser)} />
    {/if}

    {#if drawn && stale}
      <p class="stale">
        Vous avez gardé d'autres Prénoms depuis le tirage. Ils ne peuvent pas entrer dans un tournoi
        déjà commencé.
        <button class="link" onclick={() => drawBracket(ui.mode)}>Refaire le tirage</button>
      </p>
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

  .empty p,
  .done,
  .stale {
    color: var(--ink-soft);
  }

  .stale {
    margin-top: 1.5rem;
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    font: inherit;
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
