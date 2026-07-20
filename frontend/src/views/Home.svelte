<script lang="ts">
  import { idFromInput, sessionPath } from "../lib/route";
  import { beginSession, go, status } from "../lib/state.svelte";

  /**
   * Join or create, and nothing else. The homepage never lists past Sessions
   * because the device remembers none: a device that remembers nothing is a
   * device that can lose nothing (ADR 0003).
   */
  let typed = $state("");
  let refused = $state(false);

  const id = $derived(idFromInput(typed));

  /**
   * A path that is not a Session lands here rather than on a 404, because the
   * usual cause is a link typed back in by hand and losing a character — and a
   * homepage that says nothing would look like the link simply did not work.
   */
  const mistyped = location.pathname !== "/";

  function join(event: SubmitEvent) {
    event.preventDefault();
    if (id === null) {
      refused = true;
      return;
    }
    go(sessionPath(id));
  }
</script>

<div class="home">
  <h1>Prénoms</h1>
  <p class="lede">
    Deux parents, chacun sa liste. Vous jugez les Prénoms chacun de votre côté, puis vous départagez
    ensemble ceux que l'un ou l'autre a gardés.
  </p>

  {#if mistyped}
    <p class="error">
      Ce lien ne mène à aucune session — il en manque sans doute un caractère. Recopiez-le
      entièrement ci-dessous.
    </p>
  {/if}

  <button class="cta" onclick={() => beginSession()} disabled={status.phase === "loading"}>
    {status.phase === "loading" ? "Création…" : "Créer une session"}
  </button>

  <!-- Never a silent failure: the button that does nothing is the worst answer. -->
  {#if status.phase === "error"}
    <p class="error">{status.message}</p>
  {/if}

  <form onsubmit={join}>
    <label for="join">Ou rejoignez une session existante</label>
    <div class="row">
      <input
        id="join"
        type="text"
        bind:value={typed}
        oninput={() => (refused = false)}
        placeholder="Lien ou code"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
      />
      <button type="submit">Rejoindre</button>
    </div>
    {#if refused}
      <!-- Never guessed at: a mistyped code is a code, not a missing Session. -->
      <p class="error">Ce lien ou ce code ne ressemble pas à une session.</p>
    {/if}
  </form>

  <p class="warning">
    Une session n'a ni compte ni mot de passe : <strong>le lien est la seule clé</strong>. Gardez-le,
    et envoyez-le à l'autre parent.
  </p>
</div>

<style>
  .home {
    max-width: 30rem;
    margin: 0 auto;
    padding: 3rem 1.25rem;
  }

  h1 {
    font-size: 1.1rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0 0 1.5rem;
  }

  .lede {
    font-size: 1.15rem;
    line-height: 1.5;
    margin: 0 0 2rem;
  }

  .cta {
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--paper);
    padding: 0.7rem 1.4rem;
    font-size: 1rem;
  }

  .cta:disabled {
    opacity: 0.5;
    cursor: default;
  }

  form {
    margin-top: 2.5rem;
    border-top: 1px solid var(--line);
    padding-top: 1.5rem;
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
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 999px;
    padding: 0.55rem 1.1rem;
    color: var(--ink-soft);
  }

  .error {
    color: var(--reject);
    font-size: 0.9rem;
  }

  .warning {
    margin-top: 2.5rem;
    font-size: 0.9rem;
    color: var(--ink-soft);
    line-height: 1.5;
  }
</style>
