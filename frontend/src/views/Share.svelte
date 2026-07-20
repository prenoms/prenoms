<script lang="ts">
  import { sessionPath } from "../lib/route";
  import { session, setView } from "../lib/state.svelte";

  /**
   * The screen that hands over the link. It comes before the app rather than
   * after it because there is no recovery path: no account, no email, and an id
   * nobody could guess — lose the link and the Session is gone for good
   * (ADR 0003). So this says that plainly rather than politely.
   */
  const link = $derived(
    session.id === null ? "" : `${location.origin}${sessionPath(session.id)}`,
  );

  let copied = $state(false);
  let manual = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
      manual = false;
    } catch {
      // No clipboard permission, or an insecure origin. The field is readonly
      // and selectable, so there is still a way — say which.
      manual = true;
    }
  }
</script>

<div class="share">
  <h2>Votre session est prête.</h2>

  <p class="warning">
    <strong>Ce lien est la seule clé.</strong> Il n'y a ni compte ni mot de passe : si vous le perdez,
    la session est perdue avec lui, et personne ne peut vous la rendre. Envoyez-le à l'autre parent et
    gardez-le quelque part.
  </p>

  <label for="link">Le lien de la session</label>
  <div class="row">
    <input id="link" type="text" readonly value={link} onfocus={(e) => e.currentTarget.select()} />
    <button class="copy" onclick={copy}>{copied ? "Copié" : "Copier"}</button>
  </div>

  {#if manual}
    <p class="hint">Copie automatique impossible — sélectionnez le lien et copiez-le à la main.</p>
  {/if}

  <p class="code">
    Code de la session : <strong>{session.id}</strong> — il se lit aussi au téléphone.
  </p>

  <button class="cta" onclick={() => setView("browse")}>Continuer</button>
</div>

<style>
  .share {
    max-width: 32rem;
    margin: 0 auto;
    padding: 2.5rem 1.25rem 3rem;
  }

  h2 {
    font-size: 1.5rem;
    margin: 0 0 1rem;
  }

  .warning {
    line-height: 1.55;
    border-left: 3px solid var(--accent);
    padding-left: 0.9rem;
    margin: 0 0 2rem;
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
    font-size: 0.95rem;
    padding: 0.55rem 0.9rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: #fff;
    color: inherit;
  }

  .copy {
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 999px;
    padding: 0.55rem 1.1rem;
  }

  .hint,
  .code {
    font-size: 0.9rem;
    color: var(--ink-soft);
  }

  .code strong {
    letter-spacing: 0.12em;
    color: var(--ink);
  }

  .cta {
    margin-top: 1.5rem;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--paper);
    padding: 0.65rem 1.3rem;
  }
</style>
