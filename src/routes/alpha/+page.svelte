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
    <a class="wordmark" href="https://thieez.com/" aria-label="Thieez home">
      <span>Thieez</span>
    </a>
    <span class="header-meta">THIEEZ / EARLY ACCESS</span>
  </header>

  <main class="main-content alpha-content">
    <section class="alpha-intro">
      <p class="eyebrow">THIEEZ / EARLY ACCESS</p>
      <h1>Sign in for <em>Alpha.</em></h1>
      <p class="alpha-intro-note">
        Request access to independent software projects from Thieez.
      </p>
    </section>

    <section class="alpha-panel" aria-label="Alpha account access">
      <p class="alpha-panel-label"><span>01</span> ACCOUNT ACCESS</p>

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
          Continue with Google
          <svg class="alpha-button-icon google-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
            <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
            <path fill="#FBBC05" d="M12.6 27.7a12 12 0 0 1 0-7.5v-5.3H5.8a20 20 0 0 0 0 18.1l6.8-5.3Z" />
            <path fill="#EA4335" d="M24 11.8c3 0 5.7 1 7.8 3.1l5.9-5.9A19.7 19.7 0 0 0 24 4 20 20 0 0 0 5.8 14.9l6.8 5.3c1.6-4.8 6.1-8.4 11.4-8.4Z" />
          </svg>
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
          Go to Thieez
          <svg class="alpha-button-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M6 14 14 6M6 6h8v8" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
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
          <svg class="alpha-button-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M6 14 14 6M6 6h8v8" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
      {/if}

      {#if errorMessage && !loading && !loadError}
        <p class="alpha-error" role="alert">{errorMessage}</p>
      {/if}
    </section>
  </main>

  <footer class="footer alpha-footer">
    <a href="/">THIEEZ.COM</a>
    <span>ALPHA ACCESS · GOOGLE SIGN-IN</span>
  </footer>
</div>
