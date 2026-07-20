<script lang="ts">
  import type { Contender } from "../lib/duel";
  import DuelBoard from "../components/DuelBoard.svelte";
  import Ranking from "../components/Ranking.svelte";
  import {
    finalDuelsOf,
    finalRatingOf,
    resolveFinalDuel,
    session,
    ui,
  } from "../lib/state.svelte";

  /**
   * The Final Profile: one Shortlist per Mode, one shared Rating, both parents
   * playing into it. `Swipe` and `Browse` are per-Profile and end at the merge —
   * there are no Verdicts here, only Duels.
   *
   * The Shortlist is the Rating map's key set: the merge gave every Prénom
   * either parent kept a Rating, and nothing else has one.
   */
  const contenders = $derived<Contender[]>(
    Object.keys(session.final?.modes[ui.mode].ratings ?? {})
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((prenom) => ({
        prenom,
        rating: finalRatingOf(prenom),
        duels: finalDuelsOf(prenom),
      })),
  );

  const duelsPlayed = $derived(contenders.reduce((total, c) => total + c.duels, 0) / 2);

  type Tab = "duel" | "ranking" | "list";
  const TABS: { id: Tab; label: string }[] = [
    { id: "duel", label: "Duels" },
    { id: "ranking", label: "Classement" },
    { id: "list", label: "La liste" },
  ];
  let tab = $state<Tab>("duel");
</script>

<div class="final">
  <p class="lede">
    Les deux profils ont terminé. Cette liste réunit tout ce que l'un <em>ou</em> l'autre a gardé, à
    égalité au départ : c'est ici que vous la départagez, ensemble.
  </p>

  {#if contenders.length === 0}
    <p class="empty">Aucun Prénom gardé dans ce Deck. Essayez l'autre Mode.</p>
  {:else}
    <div class="head">
      <p class="tally">
        {duelsPlayed} duel{duelsPlayed > 1 ? "s" : ""} · {contenders.length} Prénoms
      </p>
      <nav aria-label="Vue de la liste finale">
        {#each TABS as { id, label } (id)}
          <button class:active={tab === id} aria-pressed={tab === id} onclick={() => (tab = id)}>
            {label}
          </button>
        {/each}
      </nav>
    </div>

    {#if tab === "duel"}
      {#if contenders.length < 2}
        <p class="empty">Il faut au moins deux Prénoms pour un duel.</p>
      {:else}
        <!-- Only the fact is reported: the Elo is the server's, computed inside
             the lock, so two parents picking at once both count (ADR 0003). -->
        <DuelBoard {contenders} nom={session.nom} onpick={resolveFinalDuel} />
      {/if}
    {:else if tab === "ranking"}
      <Ranking {contenders} nom={session.nom} />
    {:else}
      <ul class="list">
        {#each contenders as { prenom } (prenom)}
          <li>{prenom}</li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .final {
    max-width: 32rem;
    margin: 0 auto;
    padding: 1rem 1.25rem 3rem;
  }

  .lede {
    color: var(--ink-soft);
    line-height: 1.5;
    margin: 0 0 1.25rem;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .tally {
    margin: 0;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  nav {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
    padding: 0.2rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: #fff;
  }

  nav button {
    border: 0;
    border-radius: 999px;
    background: none;
    padding: 0.3rem 0.8rem;
    font-size: 0.8rem;
    color: var(--ink-soft);
  }

  nav button.active {
    background: var(--ink);
    color: var(--paper);
  }

  .list {
    list-style: none;
    padding: 0;
    margin: 1.25rem 0 0;
    columns: 2;
    line-height: 1.9;
  }

  .empty {
    color: var(--ink-soft);
    margin-top: 1.5rem;
  }
</style>
