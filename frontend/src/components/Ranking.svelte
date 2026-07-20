<script lang="ts">
  import { isProvisional, type Contender } from "../lib/duel";

  /**
   * The Shortlist ordered by Rating. Readable at any time, sharper the more
   * Duels have been played, never final — hence the badge on the Prénoms that
   * have not been in enough of them to have earned their place yet.
   */
  let { contenders, nom = null }: { contenders: Contender[]; nom?: string | null } = $props();

  const ranking = $derived(contenders.slice().sort((a, b) => b.rating - a.rating));
  const provisional = $derived(new Set(contenders.filter(isProvisional).map((c) => c.prenom)));
</script>

<ol class="ranking">
  {#each ranking as { prenom, rating } (prenom)}
    <li>
      <span class="place"></span>
      <span class="prenom"
        >{prenom}{#if nom}&nbsp;<span class="nom">{nom}</span>{/if}</span
      >
      {#if provisional.has(prenom)}<span class="badge">à confirmer</span>{/if}
      <span class="rating">{Math.round(rating)}</span>
    </li>
  {/each}
</ol>

<style>
  .ranking {
    list-style: none;
    counter-reset: place;
    padding: 0;
    margin: 1.25rem 0 0;
  }

  li {
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

  .badge {
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
  }

  .rating {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
</style>
