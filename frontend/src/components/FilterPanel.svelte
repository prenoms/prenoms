<script lang="ts">
  import { activeCount, type Span } from "../lib/prenom-filter";
  import { filter, resetFilter } from "../lib/state.svelte";

  /**
   * The four criteria of form, in a panel that stays in the flow under the
   * toolbar rather than behind a scrim: the whole point of a slider here is
   * watching the list shrink under it while you drag.
   *
   * The ends of each slider are the Deck's own, handed down by Parcourir — see
   * `bounds()` in `prenom-filter.ts`. A criterion dragged back to its end is
   * stored as `null`, so "no bound" and "the widest bound this Deck happens to
   * have" stay two different things.
   */
  let { bounds }: { bounds: { letters: Span; syllables: Span } } = $props();

  type Criterion = "letters" | "syllables";

  function setMin(key: Criterion, span: Span, raw: number) {
    const value = Math.min(raw, filter[key].max ?? span.max);
    filter[key].min = value === span.min ? null : value;
  }

  function setMax(key: Criterion, span: Span, raw: number) {
    const value = Math.max(raw, filter[key].min ?? span.min);
    filter[key].max = value === span.max ? null : value;
  }
</script>

{#snippet criterion(legend: string, key: Criterion, span: Span)}
  <fieldset>
    <legend>{legend}</legend>
    <label>
      <span class="side">de</span>
      <input
        type="range"
        min={span.min}
        max={span.max}
        value={filter[key].min ?? span.min}
        oninput={(e) => setMin(key, span, e.currentTarget.valueAsNumber)}
      />
      <output>{filter[key].min ?? span.min}</output>
    </label>
    <label>
      <span class="side">à</span>
      <input
        type="range"
        min={span.min}
        max={span.max}
        value={filter[key].max ?? span.max}
        oninput={(e) => setMax(key, span, e.currentTarget.valueAsNumber)}
      />
      <output>{filter[key].max ?? span.max}</output>
    </label>
  </fieldset>
{/snippet}

<div class="panel">
  {@render criterion("Lettres", "letters", bounds.letters)}
  {@render criterion("Syllabes", "syllables", bounds.syllables)}

  <div class="switches">
    <label>
      <input type="checkbox" bind:checked={filter.showComposed} />
      Prénoms composés
    </label>
    <label>
      <input type="checkbox" bind:checked={filter.showMixed} />
      Prénoms mixtes
    </label>
  </div>

  {#if activeCount(filter) > 0}
    <button class="reset" onclick={resetFilter}>Tout réinitialiser</button>
  {/if}
</div>

<style>
  .panel {
    padding: 0.75rem 0 0.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  legend,
  .side {
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  legend {
    padding: 0;
    margin-bottom: 0.15rem;
  }

  fieldset label {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .side {
    width: 1.2rem;
    text-align: right;
  }

  input[type="range"] {
    flex: 1;
    accent-color: var(--accent);
    min-width: 0;
  }

  output {
    width: 1.6rem;
    text-align: right;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }

  .switches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.2rem;
  }

  .switches label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
  }

  input[type="checkbox"] {
    accent-color: var(--accent);
    width: 1.1rem;
    height: 1.1rem;
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .reset {
    align-self: flex-start;
    border: 0;
    background: none;
    padding: 0.15rem 0;
    font-size: 0.8rem;
    color: var(--ink-soft);
    text-decoration: underline;
  }
</style>
