<script lang="ts">
  import { duelsLeft, isDecided, placesWanted } from "../lib/bracket";
  import DuelBoard from "../components/DuelBoard.svelte";
  import Ranking from "../components/Ranking.svelte";
  import { finalBracketOf, finalDuelFor, resolveFinalDuel, session, ui } from "../lib/state.svelte";

  /**
   * The Final Profile: one Shortlist per Mode, one shared tournament, both
   * parents playing it. `Swipe` and `Browse` are per-Profile and end at the
   * merge — there are no Verdicts here, only Duels.
   *
   * The draw is the server's, made at the merge, and the two parents are handed
   * different Duels from it: early rounds hold many independent matches, so
   * neither waits on the other and no answer is thrown away (ADR 0003).
   */
  const bracket = $derived(finalBracketOf(ui.mode));
  const duel = $derived(finalDuelFor(ui.mode));
  const left = $derived(duelsLeft(bracket));

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
    Les deux profils ont terminé. Cette liste réunit tout ce que l'un <em>ou</em> l'autre a gardé,
    tiré au sort en tournoi : c'est ici que vous jouez les duels, ensemble, jusqu'au Top {placesWanted(
      bracket,
    )}. Chacun sa question, et le nombre de duels est fini.
  </p>

  {#if bracket.field.length === 0}
    <p class="empty">Aucun Prénom gardé dans ce Deck. Essayez l'autre Mode.</p>
  {:else}
    <div class="head">
      <p class="tally">
        {bracket.played} duel{bracket.played > 1 ? "s" : ""} · {bracket.field.length} Prénoms
        {#if left > 0}· encore {left} au plus{/if}
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
      {#if isDecided(bracket)}
        <p class="empty">
          Le tournoi est joué. Votre Top {placesWanted(bracket)} est dans l'onglet Classement.
        </p>
      {:else if duel === null}
        <p class="empty">Rien à départager de votre côté pour l'instant.</p>
      {:else}
        <!-- Only the fact is reported: the Place it settles is the server's,
             worked out inside the lock, so two parents picking at once both
             count (ADR 0003). -->
        <DuelBoard {duel} nom={session.nom} onpick={(winner, loser) => resolveFinalDuel(ui.mode, winner, loser)} />
      {/if}
    {:else if tab === "ranking"}
      <Ranking {bracket} nom={session.nom} />
    {:else}
      <ul class="list">
        {#each [...bracket.field].sort((a, b) => a.localeCompare(b, "fr")) as prenom (prenom)}
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
