<script lang="ts">
  import { isDecided, placesWanted, unranked, type BracketState } from "../lib/bracket";

  /**
   * The podium: the Places the tournament has actually awarded, in order. There
   * is no score beside a Prénom because there is no score — a Place is a
   * tournament somebody won, and a number would invite reading a gap between
   * two Prénoms that nobody ever measured.
   *
   * Everything below the podium is shown as one unordered set, deliberately.
   * The Prénom knocked out in round one by the eventual winner was told nothing
   * about how it compares to the one knocked out in round one by anybody else,
   * and putting the two in a list would claim otherwise.
   */
  let { bracket, nom = null }: { bracket: BracketState; nom?: string | null } = $props();

  const rest = $derived(unranked(bracket).sort((a, b) => a.localeCompare(b, "fr")));
  const wanted = $derived(placesWanted(bracket));
</script>

<ol class="ranking">
  {#each bracket.places as prenom (prenom)}
    <li>
      <span class="place"></span>
      <span class="prenom"
        >{prenom}{#if nom}&nbsp;<span class="nom">{nom}</span>{/if}</span
      >
    </li>
  {/each}
</ol>

{#if !isDecided(bracket)}
  <p class="progress">
    {bracket.places.length} place{bracket.places.length > 1 ? "s" : ""} sur {wanted} attribuée{bracket.places
      .length > 1
      ? "s"
      : ""}.
  </p>
{/if}

{#if rest.length > 0}
  <div class="rest">
    <h3>Les autres</h3>
    <p class="note">
      Sans ordre : le tournoi ne les a pas départagés entre eux, et prétendre le contraire serait
      inventer des duels qui n'ont pas eu lieu.
    </p>
    <ul>
      {#each rest as prenom (prenom)}
        <li>{prenom}</li>
      {/each}
    </ul>
  </div>
{/if}

<style>
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

  .prenom {
    font-size: 1.2rem;
  }

  .nom {
    color: var(--ink-soft);
  }

  .progress,
  .note {
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .rest {
    margin-top: 2rem;
  }

  .rest h3 {
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin: 0 0 0.35rem;
  }

  .rest ul {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
    columns: 2;
    line-height: 1.9;
  }
</style>
