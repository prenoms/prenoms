<script lang="ts">
  import { duelOrder, type Duel } from "../lib/bracket";

  /**
   * One Duel on screen: two Prénoms from the same Shortlist, resolved by
   * picking one. Shared by the per-Profile phase (`Game`) and the Final Profile
   * (`Final`) because the Duel is the same act in both — what differs is whose
   * Ranking it settles, and that is the caller's business: `onpick` reports the
   * fact and nothing else.
   *
   * Which Duel to ask is never decided here. It comes from the Bracket, which
   * is the only thing that knows who has met whom and which node of the tree is
   * still waiting on an answer.
   */
  let {
    duel,
    nom = null,
    onpick,
  }: {
    duel: Duel;
    nom?: string | null;
    onpick: (winner: string, loser: string) => void;
  } = $props();

  // One side of the tree would otherwise always be the left-hand card.
  const shown = $derived(duelOrder(duel));

  function pick(winner: string) {
    onpick(winner, shown[0] === winner ? shown[1] : shown[0]);
  }
</script>

<p class="prompt">Lequel préférez-vous ?</p>
<div class="duel">
  {#each shown as prenom (prenom)}
    <button class="contender" onclick={() => pick(prenom)}>
      <span class="prenom">{prenom}</span>
      {#if nom}<span class="nom">{nom}</span>{/if}
    </button>
  {/each}
</div>

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

</style>
