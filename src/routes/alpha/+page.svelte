<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getAlphaAccessStatus,
    restoreAuth,
    startLogin,
    submitAlphaAccessRequest,
    type AlphaAccessStatus,
    type AuthSession
  } from '$lib/auth-client';

  let session: AuthSession | null = null;
  let status: AlphaAccessStatus | null = null;
  let loading = true;
  let submitting = false;
  let loadError = '';
  let errorMessage = '';

  onMount(() => {
    void (async () => {
      try {
        session = await restoreAuth();
        if (session) status = await getAlphaAccessStatus();
      } catch (cause) {
        loadError = cause instanceof Error ? cause.message : 'Could not load Alpha access.';
      } finally {
        loading = false;
      }
    })();
  });

  const requestAccess = async () => {
    if (submitting) return;
    submitting = true;
    errorMessage = '';
    try {
      status = await submitAlphaAccessRequest();
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Could not request Alpha access.';
    } finally {
      submitting = false;
    }
  };
</script>

<svelte:head>
  <title>Thieez Alpha</title>
  <meta
    name="description"
    content="Sign in with Google to request access to Thieez Alpha."
  />
</svelte:head>

<div class="site-shell alpha-shell">
  <header class="masthead">
    <a class="wordmark" href="/" aria-label="Thieez home">
      <span class="project-word">thieez</span><span class="wordmark-dot">.</span>
    </a>
    <span class="header-meta">EARLY ACCESS</span>
  </header>

  <main class="main-content alpha-content">
    <p class="eyebrow">THIEEZ / EARLY ACCESS</p>
    <h1>Sign in for <em>Alpha.</em></h1>

    {#if loading}
      <div class="state-panel alpha-state" aria-live="polite">
        <span class="loader" aria-hidden="true"></span>
        <span>Checking your account…</span>
      </div>
    {:else if loadError}
      <div class="state-panel error-panel alpha-state" role="alert">
        <strong>Couldn’t check Alpha access.</strong>
        <span>{loadError}</span>
        <button class="text-button" onclick={() => window.location.reload()}>Try again</button>
      </div>
    {:else if !session}
      <p class="lede alpha-copy">
        Sign in with Google to request access. An administrator will review your request.
      </p>
      <button class="alpha-button" onclick={startLogin}>
        Sign in <span aria-hidden="true">↗</span>
      </button>
    {:else if status?.status === 'pending'}
      <p class="lede alpha-copy">Your access request is waiting for administrator approval.</p>
      <div class="alpha-status" role="status">
        <span class="alpha-status-dot"></span>
        Request received <span>We’ll email you when Alpha access is approved.</span>
      </div>
    {:else if status?.status === 'approved' && status.has_access}
      <p class="lede alpha-copy">Your request has been approved. You can now access all Thieez projects.</p>
      <a class="alpha-button alpha-link-button" href="/">
        Go to Thieez <span aria-hidden="true">↗</span>
      </a>
    {:else}
      <p class="lede alpha-copy">
        {status?.status === 'rejected'
          ? 'Your previous request was declined. You can submit a new request.'
          : status?.status === 'revoked'
            ? 'Your previous Alpha access has been revoked. You can request access again.'
            : status?.status === 'approved'
              ? 'Your Alpha request was approved, but project access is currently disabled.'
              : 'Sign in with Google to request access. An administrator will review your request.'}
      </p>
      <button class="alpha-button" disabled={submitting} onclick={() => void requestAccess()}>
        {submitting ? 'Submitting…' : status?.status === 'not_requested' ? 'Request Alpha access' : 'Request access again'}
        <span aria-hidden="true">↗</span>
      </button>
    {/if}

    {#if errorMessage && !loading && !loadError}
      <p class="alpha-error" role="alert">{errorMessage}</p>
    {/if}
  </main>

  <footer class="footer alpha-footer">
    <a href="/">THIEEZ.COM</a>
    <span>ALPHA ACCESS · GOOGLE SIGN-IN</span>
  </footer>
</div>
