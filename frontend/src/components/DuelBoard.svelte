<script lang="ts">
  import { choosePair, isProvisional, type Contender, type Pair } from "../lib/duel";

  /**
   * One Duel on screen: two Prénoms from the same Shortlist, resolved by
   * picking one, nothing eliminated. Shared by the per-Profile phase (`Game`)
   * and the Final Profile (`Final`) because the Duel is the same act in both —
   * what differs is whose Ratings move, and that is the caller's business:
   * `onpick` reports the fact and nothing else.
   */
  let {
    contenders,
    nom = null,
    onpick,
  }: {
    contenders: Contender[];
    nom?: string | null;
    onpick: (winner: string, loser: string) => void;
  } = $props();

  let pair = $state<Pair | null>(null);

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

  const provisional = $derived(new Set(contenders.filter(isProvisional).map((c) => c.prenom)));

  function pick(winner: string) {
    if (!pair) return;
    const loser = pair[0] === winner ? pair[1] : pair[0];
    onpick(winner, loser);
    nextPair(pair);
  }
</script>

{#if pair}
  <p class="prompt">Lequel préférez-vous ?</p>
  <div class="duel">
    {#each pair as prenom (prenom)}
      <button class="contender" onclick={() => pick(prenom)}>
        <span class="prenom">{prenom}</span>
        {#if nom}<span class="nom">{nom}</span>{/if}
        {#if provisional.has(prenom)}<span class="badge">à confirmer</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
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

  .prenom {
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
</style>
