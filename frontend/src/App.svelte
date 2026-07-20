<script lang="ts">
  import { MODES, type Mode } from "./lib/domain";
  import {
    go,
    profile,
    route,
    session,
    setMode,
    setNom,
    setView,
    status,
    syncFromUrl,
    ui,
    type View,
  } from "./lib/state.svelte";
  import Browse from "./views/Browse.svelte";
  import Swipe from "./views/Swipe.svelte";
  import Game from "./views/Game.svelte";
  import Home from "./views/Home.svelte";
  import Join from "./views/Join.svelte";
  import Share from "./views/Share.svelte";
  import Final from "./views/Final.svelte";
  import Banner from "./components/Banner.svelte";
  import Ready from "./components/Ready.svelte";

  const MODE_LABEL: Record<Mode, string> = { male: "Masculin", female: "Féminin" };
  const SWIPE_VIEWS: { id: View; label: string }[] = [
    { id: "browse", label: "Parcourir" },
    { id: "swipe", label: "Cartes" },
    { id: "game", label: "Duels" },
  ];

  void syncFromUrl();

  /**
   * Which screen the Session route is on. The order is the flow: the link
   * first, then who you are, then the app or — once merged — the Final Profile.
   * A merged Session asks nobody who they are: the Final Profile belongs to the
   * Session, so holding the link is enough to duel it (ADR 0003).
   */
  const screen = $derived(
    ui.view === "share" ? "share" : session.merged ? "final" : profile.id === null ? "join" : "app",
  );

  /** What each screen is entitled to. Both the Deck and the Nom outlive the
   *  merge; the swipe views and everything about your own Profile do not. */
  const choosesMode = $derived(screen === "app" || screen === "final");
  const isSwiping = $derived(screen === "app");
</script>

{#if route.current.name === "home"}
  <Home />
{:else if status.phase === "error"}
  <p class="notice">
    {status.message}
    <button class="ghost" onclick={() => go("/")}>Retour à l'accueil</button>
  </p>
{:else if status.phase !== "ready"}
  <p class="notice">Chargement de la session…</p>
{:else}
  <header>
    <h1><button class="home" onclick={() => go("/")}>Prénoms</button></h1>

    {#if choosesMode}
      <nav class="modes" aria-label="Mode">
        {#each MODES as mode (mode)}
          <button
            class:active={ui.mode === mode}
            aria-pressed={ui.mode === mode}
            onclick={() => setMode(mode)}>{MODE_LABEL[mode]}</button
          >
        {/each}
      </nav>
    {/if}

    {#if isSwiping}
      <nav class="views" aria-label="Vue">
        {#each SWIPE_VIEWS as { id, label } (id)}
          <button
            class:active={ui.view === id}
            aria-current={ui.view === id ? "page" : undefined}
            onclick={() => setView(id)}>{label}</button
          >
        {/each}
      </nav>
    {/if}

    {#if choosesMode}
      <input
        class="nom"
        type="text"
        value={session.nom ?? ""}
        oninput={(event) => setNom(event.currentTarget.value)}
        placeholder="Nom (optionnel)"
        autocomplete="family-name"
        aria-label="Nom, à lire après le Prénom"
      />
    {/if}

    {#if isSwiping}
      <span class="who">{profile.name}</span>
      <button class="link" onclick={() => setView("share")}>Le lien</button>
      <Ready />
    {/if}
  </header>

  <main>
    {#if screen === "share"}
      <Share />
    {:else if screen === "final"}
      <!-- Keyed on the Mode: one Shortlist per Mode, so switching swaps the
           whole working set — including the pair on screen. -->
      {#key ui.mode}
        <Final />
      {/key}
    {:else if screen === "join"}
      <Join />
    {:else if ui.view === "browse"}
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
  </main>
{/if}

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
    margin-right: auto;
    font-size: 1.1rem;
  }

  .home {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    letter-spacing: 0.06em;
    text-transform: uppercase;
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

  .who {
    font-size: 0.8rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .link {
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 999px;
    padding: 0.35rem 0.85rem;
    font-size: 0.8rem;
    color: var(--ink-soft);
  }

  .notice {
    max-width: 32rem;
    margin: 3rem auto;
    padding: 0 1.25rem;
    text-align: center;
    color: var(--ink-soft);
  }

  .ghost {
    display: block;
    margin: 1rem auto 0;
    border: 0;
    background: none;
    font-size: 0.9rem;
    color: var(--ink-soft);
    text-decoration: underline;
  }
</style>
