<script lang="ts">
  import { fold, score } from "../lib/fuzzy";
  import { deck, persisted, session, setVerdict, clearVerdict } from "../lib/state.svelte";

  let query = $state("");

  /** Whether the list shows the whole Deck or just this Mode's Shortlist. */
  let scope = $state<"deck" | "shortlist">("deck");

  const verdicts = $derived(persisted.modes[session.mode].verdicts);

  // The Deck folded once per Mode, so typing does not re-fold 1700 strings a keystroke.
  const folded = $derived(deck.current.map((p) => ({ ...p, folded: fold(p.prenom) })));

  const scoped = $derived(
    scope === "shortlist" ? folded.filter((p) => verdicts[p.prenom] === "keep") : folded,
  );

  const results = $derived.by(() => {
    const needle = fold(query.trim());
    if (needle === "") return scoped;
    return scoped
      .map((p) => ({ p, score: score(needle, p.folded) }))
      .filter((r): r is { p: (typeof folded)[number]; score: number } => r.score !== null)
      .sort((a, b) => b.score - a.score || a.p.prenom.localeCompare(b.p.prenom, "fr"))
      .map((r) => r.p);
  });

  const shortlistSize = $derived(
    deck.current.filter((p) => verdicts[p.prenom] === "keep").length,
  );

  /**
   * Starring writes a keep Verdict; un-starring clears it entirely rather than
   * writing a reject, so the Prénom returns to the swipe Deck unjudged.
   */
  function toggleStar(prenom: string) {
    if (verdicts[prenom] === "keep") clearVerdict(prenom);
    else setVerdict(prenom, "keep");
  }
</script>

<div class="browse">
  <div class="toolbar">
    <input
      type="search"
      bind:value={query}
      placeholder="Chercher un Prénom"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      aria-label="Chercher un Prénom"
    />
    <div class="scope">
      <button
        class:active={scope === "deck"}
        aria-pressed={scope === "deck"}
        onclick={() => (scope = "deck")}>Deck {deck.current.length}</button
      >
      <button
        class:active={scope === "shortlist"}
        aria-pressed={scope === "shortlist"}
        onclick={() => (scope = "shortlist")}>Shortlist {shortlistSize}</button
      >
      <p class="tally">{results.length} affichés</p>
    </div>
  </div>

  {#if results.length === 0}
    <p class="empty">
      {#if query.trim() !== ""}
        Aucun Prénom ne correspond à « {query.trim()} ».
      {:else}
        Shortlist vide — mettez une étoile, ou gardez des Prénoms dans les Cartes.
      {/if}
    </p>
  {:else}
    <ul>
      {#each results as { prenom } (prenom)}
        {@const verdict = verdicts[prenom]}
        <li class:rejected={verdict === "reject"}>
          <!-- No Nom here: the list is for scanning, the card is for reading aloud. -->
          <span class="prenom">{prenom}</span>
          <button
            class="star"
            class:kept={verdict === "keep"}
            aria-pressed={verdict === "keep"}
            aria-label={verdict === "keep" ? `Retirer ${prenom}` : `Garder ${prenom}`}
            onclick={() => toggleStar(prenom)}>{verdict === "keep" ? "★" : "☆"}</button
          >
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .browse {
    max-width: 32rem;
    margin: 0 auto;
  }

  .toolbar {
    position: sticky;
    top: 0;
    background: var(--paper);
    padding: 1rem 1.25rem 0.5rem;
    border-bottom: 1px solid var(--line);
  }

  input {
    width: 100%;
    font: inherit;
    font-size: 1rem;
    padding: 0.6rem 0.9rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: #fff;
    color: inherit;
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .scope {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.6rem;
  }

  .scope button {
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 999px;
    padding: 0.25rem 0.75rem;
    font-size: 0.8rem;
    color: var(--ink-soft);
  }

  .scope button.active {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper);
  }

  .tally {
    margin-left: auto;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0 0 4rem;
  }

  li {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.15rem 1.25rem;
    border-bottom: 1px solid var(--line);
  }

  .prenom {
    font-size: 1.15rem;
  }

  li.rejected .prenom {
    color: var(--ink-soft);
    text-decoration: line-through;
    text-decoration-color: var(--line);
  }

  .star {
    margin-left: auto;
    border: 0;
    background: none;
    font-size: 1.4rem;
    line-height: 1;
    padding: 0.6rem;
    color: var(--line);
  }

  .star.kept {
    color: var(--accent);
  }

  .empty {
    padding: 2rem 1.25rem;
    color: var(--ink-soft);
  }
</style>
