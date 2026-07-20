<script lang="ts">
  import { connection } from "../lib/state.svelte";
</script>

<!--
  Never a silent failure. While writes are being retried the banner stays up and
  says plainly what closing the tab would cost: there is no offline queue, so
  swipes made during an outage exist only in this tab (ADR 0003).
-->
{#if connection.failing}
  <div class="banner" role="alert" aria-live="assertive">
    <strong>Connexion perdue.</strong>
    Vos derniers choix ne sont pas enregistrés. Ils seront perdus si vous fermez cet onglet.
  </div>
{/if}

<!--
  A refusal the server will never accept — the Session has merged, or this
  Profile is ready. Not dismissible: what is on screen no longer matches what
  the Session holds, and hiding that would only make the screen convincing.
-->
{#if connection.refused}
  <div class="banner refused" role="alert">
    <strong>{connection.refused}</strong>
    Rechargez la page pour repartir de l'état de la session.
  </div>
{/if}

<style>
  .banner {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 1.25rem;
    font-size: 0.9rem;
    background: #7a1d1d;
    color: #fff;
  }

  .refused {
    background: var(--ink);
  }
</style>
