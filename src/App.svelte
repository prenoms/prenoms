<script lang="ts">
  import { MODES, type Mode } from "./lib/domain";
  import {
    bootstrapFromQuery,
    session,
    setMode,
    setNom,
    setView,
    status,
    ui,
    type View,
  } from "./lib/state.svelte";
  import Browse from "./views/Browse.svelte";
  import Swipe from "./views/Swipe.svelte";
  import Game from "./views/Game.svelte";
  import Banner from "./components/Banner.svelte";

  const MODE_LABEL: Record<Mode, string> = { male: "Masculin", female: "Féminin" };
  const VIEW_LABEL: Record<View, string> = { browse: "Parcourir", swipe: "Cartes", game: "Duels" };

  // TEMPORARY — Phase 3 replaces this with routing on `/s/{id}` and a join screen.
  const addressed = bootstrapFromQuery();
</script>

<header>
  <h1>Prénoms</h1>

  <nav class="modes" aria-label="Mode">
    {#each MODES as mode (mode)}
      <button
        class:active={ui.mode === mode}
        aria-pressed={ui.mode === mode}
        onclick={() => setMode(mode)}>{MODE_LABEL[mode]}</button
      >
    {/each}
  </nav>

  <nav class="views" aria-label="Vue">
    {#each Object.entries(VIEW_LABEL) as [view, label] (view)}
      <button
        class:active={ui.view === view}
        aria-current={ui.view === view ? "page" : undefined}
        onclick={() => setView(view as View)}>{label}</button
      >
    {/each}
  </nav>

  <input
    class="nom"
    type="text"
    value={session.nom ?? ""}
    oninput={(event) => setNom(event.currentTarget.value)}
    placeholder="Nom (optionnel)"
    autocomplete="family-name"
    aria-label="Nom, à lire après le Prénom"
  />
</header>

<main>
  <!-- The Session lives on the server, so there is nothing to show until it has
       arrived: an unloaded Profile looks exactly like one that has judged nothing. -->
  {#if !addressed}
    <p class="notice">
      Aucune session. Ouvrez le lien de votre session — Phase&nbsp;3 ajoutera l'accueil et l'écran
      d'entrée.
    </p>
  {:else if status.phase === "error"}
    <p class="notice">{status.message}</p>
  {:else if status.phase !== "ready"}
    <p class="notice">Chargement de la session…</p>
  {:else}
    <!-- Keyed on the Mode: switching swaps the whole working set, so rebuild rather
         than diff — it also drops per-Mode view state like the undo stack. -->
    {#if ui.view === "browse"}
      {#key ui.mode}
        <Browse />
      {/key}
    {:else if ui.view === "swipe"}
      {#key ui.mode}
        <Swipe />
      {/key}
    {:else}
      {#key ui.mode}
        <Game />
      {/key}
    {/if}
  {/if}
</main>

<Banner />

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

  .notice {
    max-width: 32rem;
    margin: 3rem auto;
    padding: 0 1.25rem;
    text-align: center;
    color: var(--ink-soft);
  }

</style>
