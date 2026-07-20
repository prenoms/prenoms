<script lang="ts">
  import { addProfile, claimProfile, joinError, session, setView } from "../lib/state.svelte";

  /**
   * Who are you, this time? Asked on every cold visit, because the device
   * remembers nothing between tabs — which is also what makes the shared-tablet
   * case work without a switcher (ADR 0003). There is no password: holding the
   * link is holding the Session, and either Profile may be claimed by whoever
   * has it.
   */
  let name = $state("");

  const full = $derived(session.profiles.length >= 2);

  function create(event: SubmitEvent) {
    event.preventDefault();
    if (name.trim() === "") return;
    void addProfile(name.trim());
  }
</script>

<div class="join">
  <h2>Qui êtes-vous ?</h2>

  {#if session.profiles.length > 0}
    <ul>
      {#each session.profiles as { id, name: profileName, ready } (id)}
        <li>
          <button onclick={() => claimProfile(id)}>
            <span class="name">{profileName}</span>
            {#if ready}<span class="badge">a terminé</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if full}
    <p class="hint">
      Cette session a déjà ses deux profils. Choisissez le vôtre — c'est le même quel que soit
      l'appareil.
    </p>
  {:else}
    <form onsubmit={create}>
      <label for="new-profile">
        {session.profiles.length === 0 ? "Créez votre profil" : "Ou créez le second profil"}
      </label>
      <div class="row">
        <input
          id="new-profile"
          type="text"
          bind:value={name}
          placeholder="Votre prénom à vous"
          autocomplete="given-name"
          maxlength="30"
        />
        <button type="submit" disabled={name.trim() === ""}>Entrer</button>
      </div>
    </form>
  {/if}

  {#if joinError.message}
    <p class="error">{joinError.message}</p>
  {/if}

  <p class="link">
    <button class="ghost" onclick={() => setView("share")}>Revoir le lien de la session</button>
  </p>
</div>

<style>
  .join {
    max-width: 30rem;
    margin: 0 auto;
    padding: 2.5rem 1.25rem 3rem;
  }

  h2 {
    font-size: 1.5rem;
    margin: 0 0 1.5rem;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0 0 1.75rem;
    display: grid;
    gap: 0.6rem;
  }

  li button {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    border: 1px solid var(--line);
    border-radius: 1rem;
    background: #fff;
    padding: 0.9rem 1.1rem;
  }

  li button:hover {
    border-color: var(--accent);
  }

  .name {
    font-size: 1.2rem;
  }

  .badge {
    margin-left: auto;
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
  }

  label {
    display: block;
    font-size: 0.85rem;
    color: var(--ink-soft);
    margin-bottom: 0.5rem;
  }

  .row {
    display: flex;
    gap: 0.5rem;
  }

  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 0.55rem 0.9rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: #fff;
    color: inherit;
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  form button {
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--paper);
    padding: 0.55rem 1.1rem;
  }

  form button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .hint {
    color: var(--ink-soft);
    font-size: 0.9rem;
  }

  .error {
    color: var(--reject);
    font-size: 0.9rem;
  }

  .link {
    margin-top: 2rem;
    border-top: 1px solid var(--line);
    padding-top: 1.25rem;
  }

  .ghost {
    border: 0;
    background: none;
    padding: 0;
    font-size: 0.9rem;
    color: var(--ink-soft);
    text-decoration: underline;
  }
</style>
