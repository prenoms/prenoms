<script lang="ts">
  import { declareReadyNow, profile, refreshSession, session } from "../lib/state.svelte";

  /**
   * The one destructive action in the whole design, and the only irreversible
   * one: ready covers both Modes, cannot be undone, and merges the Session as
   * soon as every Profile has declared it (ADR 0003).
   *
   * Two things blunt it, and both are this dialog's job: it says what it ends,
   * and it says who else is in the Session and whether they have finished — so
   * nobody confirms blind, and nobody ends their partner's swiping by accident.
   */
  let asking = $state(false);

  const others = $derived(session.profiles.filter((p) => p.id !== profile.id));
  const alone = $derived(others.length === 0);
  const otherReady = $derived(others.every((p) => p.ready));
  const otherNames = $derived(others.map((p) => p.name).join(", "));

  /**
   * The Session list is otherwise a snapshot from page load, and the one fact
   * this dialog exists to state — whether the other Profile has finished — is
   * exactly the one that goes stale while you swipe. Re-read it before asking.
   */
  function ask() {
    asking = true;
    void refreshSession();
  }
</script>

{#if profile.ready}
  <p class="done">
    Vous avez terminé.
    {#if alone}
      Personne d'autre n'a rejoint cette session.
    {:else}
      En attente de {otherNames}.
    {/if}
  </p>
{:else}
  <button class="ready" onclick={ask}>J'ai fini de trier</button>
{/if}

{#if asking}
  <div class="scrim" role="presentation" onclick={() => (asking = false)}></div>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="ready-title">
    <h2 id="ready-title">Terminer, définitivement ?</h2>

    <p>
      <strong>C'est irréversible.</strong> Une fois terminé, plus personne ne trie de Prénoms dans cette
      session — ni vous, ni l'autre parent — et on ne revient pas en arrière.
    </p>

    <!-- How many have joined, and where the other one is: nobody confirms blind,
         and nobody ends a partner's swiping without being told they are doing it. -->
    <p>
      <strong>
        {session.profiles.length} profil{session.profiles.length > 1 ? "s" : ""} dans cette session.
      </strong>
      {#if alone}
        Vous êtes seul·e : personne d'autre ne l'a rejointe. Si vous terminez maintenant, elle
        fusionne aussitôt sur votre seule liste, et personne ne pourra plus s'y ajouter pour trier.
      {:else if otherReady}
        {otherNames} a déjà terminé. Si vous terminez maintenant, la session fusionne aussitôt : vos
        deux Shortlists n'en font plus qu'une, et vous la départagez ensemble en Duels.
      {:else}
        {otherNames} n'a pas encore terminé. Vous ne pourrez plus trier ; la fusion aura lieu dès que
        l'autre profil aura terminé à son tour.
      {/if}
    </p>

    <p class="small">
      À la fusion, tous les classements personnels sont remis à zéro : la liste finale réunit tout ce
      que l'un ou l'autre a gardé, et se départage depuis le début.
    </p>

    <div class="actions">
      <button class="cancel" onclick={() => (asking = false)}>Annuler</button>
      <button
        class="confirm"
        onclick={() => {
          asking = false;
          void declareReadyNow();
        }}>Oui, j'ai fini</button
      >
    </div>
  </div>
{/if}

<style>
  .ready {
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 999px;
    padding: 0.35rem 0.85rem;
    font-size: 0.8rem;
    color: var(--ink-soft);
  }

  .done {
    margin: 0;
    font-size: 0.8rem;
    color: var(--ink-soft);
    max-width: 12rem;
  }

  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(23, 22, 26, 0.45);
  }

  .dialog {
    position: fixed;
    inset: auto 1rem 1rem;
    max-width: 30rem;
    margin: 0 auto;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 1.25rem;
    padding: 1.5rem;
    box-shadow: 0 20px 50px -20px rgba(0, 0, 0, 0.5);
  }

  @media (min-width: 40rem) {
    .dialog {
      inset: 50% 1rem auto;
      transform: translateY(-50%);
    }
  }

  h2 {
    font-size: 1.25rem;
    margin: 0 0 0.75rem;
  }

  p {
    line-height: 1.5;
    margin: 0 0 0.9rem;
  }

  .small {
    font-size: 0.85rem;
    color: var(--ink-soft);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
  }

  .actions button {
    border-radius: 999px;
    padding: 0.55rem 1.1rem;
  }

  .cancel {
    border: 1px solid var(--line);
    background: #fff;
    color: var(--ink-soft);
  }

  .confirm {
    border: 0;
    background: var(--reject);
    color: #fff;
  }
</style>
