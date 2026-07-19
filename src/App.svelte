<script lang="ts">
  import { MODES, type Mode } from "./lib/domain";
  import { persisted, session, setMode, setNom, setView, type View } from "./lib/state.svelte";
  import Browse from "./views/Browse.svelte";
  import Swipe from "./views/Swipe.svelte";
  import Game from "./views/Game.svelte";
  import Backup from "./components/Backup.svelte";

  const MODE_LABEL: Record<Mode, string> = { male: "Masculin", female: "Féminin" };
  const VIEW_LABEL: Record<View, string> = { browse: "Parcourir", swipe: "Cartes", game: "Duels" };
</script>

<header>
  <h1>Prénoms</h1>

  <nav class="modes" aria-label="Mode">
    {#each MODES as mode (mode)}
      <button
        class:active={session.mode === mode}
        aria-pressed={session.mode === mode}
        onclick={() => setMode(mode)}>{MODE_LABEL[mode]}</button
      >
    {/each}
  </nav>

  <nav class="views" aria-label="Vue">
    {#each Object.entries(VIEW_LABEL) as [view, label] (view)}
      <button
        class:active={session.view === view}
        aria-current={session.view === view ? "page" : undefined}
        onclick={() => setView(view as View)}>{label}</button
      >
    {/each}
  </nav>

  <input
    class="nom"
    type="text"
    value={persisted.nom ?? ""}
    oninput={(event) => setNom(event.currentTarget.value)}
    placeholder="Nom (optionnel)"
    autocomplete="family-name"
    aria-label="Nom, à lire après le Prénom"
  />
</header>

<main>
  <!-- Keyed on the Mode: switching swaps the whole working set, so rebuild rather
       than diff — it also drops per-Mode view state like the undo stack. -->
  {#if session.view === "browse"}
    {#key session.mode}
      <Browse />
    {/key}
  {:else if session.view === "swipe"}
    {#key session.mode}
      <Swipe />
    {/key}
  {:else}
    {#key session.mode}
      <Game />
    {/key}
  {/if}
</main>

<Backup />

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--line);
  }

  h1 {
    margin: 0;
    font-size: 1.1rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-right: auto;
  }

  nav {
    display: flex;
    gap: 0.25rem;
    padding: 0.2rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: #fff;
  }

  nav button {
    border: 0;
    border-radius: 999px;
    background: none;
    padding: 0.35rem 0.85rem;
    color: var(--ink-soft);
  }

  nav button.active {
    background: var(--ink);
    color: var(--paper);
  }

  .nom {
    font: inherit;
    font-size: 0.9rem;
    width: 10rem;
    padding: 0.4rem 0.85rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: #fff;
    color: inherit;
  }

  .nom:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

</style>
