<script lang="ts">
  import { MODES } from "../lib/domain";
  import { exportState, importState, persisted } from "../lib/state.svelte";

  let input: HTMLInputElement;
  let message = $state<{ tone: "ok" | "error"; text: string } | null>(null);

  const judged = $derived(
    MODES.reduce((total, mode) => total + Object.keys(persisted.modes[mode].verdicts).length, 0),
  );

  function download() {
    const stamp = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(new Blob([exportState()], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: `prenoms-${stamp}.json`,
    });
    link.click();
    URL.revokeObjectURL(url);
    message = { tone: "ok", text: `Exporté — ${judged} Verdicts.` };
  }

  async function upload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    // Importing replaces everything; there is no undo for it.
    if (judged > 0 && !confirm("Remplacer vos Verdicts et Ratings actuels par ce fichier ?")) {
      input.value = "";
      return;
    }

    try {
      importState(await file.text());
      message = { tone: "ok", text: `Importé — ${judged} Verdicts.` };
    } catch (error) {
      message = { tone: "error", text: error instanceof Error ? error.message : "Import échoué." };
    }
    input.value = "";
  }
</script>

<footer>
  <p class="label">Sauvegarde — vos choix ne quittent jamais cet appareil.</p>
  <!-- The pair stays on one row whatever the label does to the layout. -->
  <div class="buttons">
    <button onclick={download} disabled={judged === 0}>Exporter</button>
    <button onclick={() => input.click()}>Importer</button>
  </div>
  <input
    bind:this={input}
    type="file"
    accept="application/json,.json"
    onchange={upload}
    hidden
    aria-hidden="true"
    tabindex="-1"
  />
  {#if message}
    <span class="message" class:error={message.tone === "error"}>{message.text}</span>
  {/if}
</footer>

<style>
  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    max-width: 32rem;
    margin: 0 auto;
    padding: 1.25rem;
    border-top: 1px solid var(--line);
    font-size: 0.85rem;
  }

  .label {
    margin: 0 auto 0 0;
    color: var(--ink-soft);
  }

  .buttons {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.6rem;
  }

  .buttons button {
    white-space: nowrap;
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 999px;
    padding: 0.35rem 0.9rem;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }

  button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .message {
    flex-basis: 100%;
    color: var(--keep);
  }

  .message.error {
    color: var(--reject);
  }
</style>
