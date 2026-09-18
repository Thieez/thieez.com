<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { getApkAsset, getLatestBuild, getLatestPluginBuild, getPluginZipAsset, getProjects, formatReleaseDate, API_BASE, logout, restoreAuth, startLogin, subscribeToProjectUpdates, type AuthSession, type LatestBuild, type Project } from '$lib/api';

  let isLisnnto = false;
  let isNote = false;
  let projects: Project[] = [];
  let build: LatestBuild | null = null;
  let loading = true;
  let error = '';
  let projectError = '';
  let apiStatus: 'checking' | 'online' | 'degraded' | 'offline' = 'checking';
  let authSession: AuthSession | null = null;
  let authLoading = true;

  const detectExperience = () => {
    if (!browser) return;
    const params = new URLSearchParams(window.location.search);
    const hostname = window.location.hostname.toLowerCase();
    isLisnnto = hostname === 'lisnnto.thieez.com' || params.get('project') === 'lisnnto';
    isNote = hostname === 'note.thieez.com' || params.get('project') === 'note';
  };

  const load = async () => {
    detectExperience();
    loading = true;
    error = '';
    projectError = '';
    apiStatus = 'checking';

    if (isLisnnto || isNote) {
      try {
        build = isNote ? await getLatestPluginBuild() : await getLatestBuild();
        apiStatus = 'online';
      } catch (cause) {
        apiStatus = 'offline';
        error = cause instanceof Error ? cause.message : 'The latest build could not be loaded.';
      }
    } else {
      try {
        const result = await getProjects();
        projects = result.projects;
        apiStatus = result.source === 'fallback' ? 'degraded' : 'online';
      } catch (cause) {
        apiStatus = 'offline';
        projectError = cause instanceof Error ? cause.message : 'Projects could not be loaded.';
      }
    }

    loading = false;
  };

  onMount(() => {
    let unsubscribe: () => void = () => undefined;
    void (async () => {
      const authTask = restoreAuth()
        .then((session) => {
          authSession = session;
        })
        .catch(() => {
          authSession = null;
        })
        .finally(() => {
          authLoading = false;
        });

      await load();
      await authTask;

      if (!isLisnnto && !isNote) {
        unsubscribe = subscribeToProjectUpdates(() => {
          void load();
        });
      }
    })();

    return () => unsubscribe();
  });

  const handleLogout = async () => {
    await logout(authSession);
    authSession = null;
  };

  $: apk = build ? getApkAsset(build) : undefined;
  $: pluginZip = build && isNote ? getPluginZipAsset(build) : undefined;
</script>

<svelte:head>
  <title>{isLisnnto ? 'Lisnnto — Thieez' : isNote ? 'Note — Thieez' : 'Thieez — Things we’re building'}</title>
  <meta name="description" content="Independent software projects from Thieez." />
</svelte:head>

<div class="site-shell">
  <header class="masthead">
    <a class="wordmark" href="https://thieez.com/">Thieez<span class="wordmark-dot">.</span></a>
    <div class="header-meta">
      <span class:status-online={apiStatus === 'online'} class:status-degraded={apiStatus === 'degraded'} class:status-offline={apiStatus === 'offline'} class="status-dot" aria-hidden="true"></span>
      <span>API {apiStatus} / {API_BASE.replace(/^https?:\/\//, '')}</span>
      {#if !authLoading}
        {#if authSession}
          <span class="auth-user">{authSession.user?.name || authSession.user?.email || 'Account'}</span>
          <button class="auth-button auth-button-muted" onclick={handleLogout}>Log out</button>
        {:else}
          <button class="auth-button" onclick={startLogin}>Log in with Google</button>
        {/if}
      {/if}
    </div>
  </header>

  <main class="main-content">
    {#if isLisnnto || isNote}
      <section class="hero download-hero" aria-labelledby="download-heading">
        <p class="eyebrow">THIEEZ / {isNote ? 'NOTE' : 'LISNNTO'}</p>
        <h1 id="download-heading">The latest build,<br /><em>ready when you are.</em></h1>
        <p class="lede">{isNote ? 'Download the newest Obsidian plugin build.' : 'A small, fast Android companion for keeping your listening life in order. Download the newest tester build below.'}</p>

        {#if loading}
          <div class="state-panel" aria-live="polite">
            <span class="loader" aria-hidden="true"></span>
            <span>Checking for the latest build…</span>
          </div>
        {:else if error}
          <div class="state-panel error-panel" role="alert">
            <strong>Couldn’t reach the build service.</strong>
            <span>{error}</span>
            <button class="text-button" onclick={load}>Try again <span aria-hidden="true">↗</span></button>
          </div>
        {:else if build && (apk || pluginZip)}
          <div class="release-card">
            <div class="release-topline">
              <span class="release-label">LATEST RELEASE</span>
              <span class="release-rule"></span>
              <span class="release-date">{formatReleaseDate(build.published_at)}</span>
            </div>
            <div class="release-details">
              <div>
                <p class="version">{build.tag_name || 'Latest'}</p>
                <p class="asset-name">{(apk || pluginZip)?.name}</p>
              </div>
              <a class="download-button" href={(apk || pluginZip)?.browser_download_url || (apk || pluginZip)?.download_url} download>
                Download latest {isNote ? 'plugin' : 'APK'} <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        {:else}
          <div class="state-panel">
            <strong>No build is published yet.</strong>
            <span>Check back soon — the release service is online, but there is no downloadable build.</span>
          </div>
        {/if}
      </section>
      <section class="aside-note">
        <span class="aside-index">01</span>
        <p>{isNote ? 'Thieez Note is distributed as an Obsidian plugin build.' : 'Lisnnto is in active testing. If something feels off, that is useful information.'}</p>
      </section>
    {:else}
      <section class="hero index-hero" aria-labelledby="index-heading">
        <p class="eyebrow">PROJECT INDEX</p>
        <h1 id="index-heading">Things we’re<br /><em>building.</em></h1>
        <p class="lede">Small software experiments, shipped carefully. A living index of what’s on our workbench.</p>
      </section>

      <section class="project-section" aria-labelledby="projects-heading">
        <div class="section-heading">
          <h2 id="projects-heading">Selected work</h2>
          <span>{projects.length.toString().padStart(2, '0')} projects</span>
        </div>
        {#if loading}
          <div class="state-panel" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Loading the index…</span></div>
        {:else if projectError}
          <div class="state-panel error-panel" role="alert"><strong>The index is taking a break.</strong><span>{projectError}</span><button class="text-button" onclick={load}>Try again <span aria-hidden="true">↗</span></button></div>
        {:else if projects.length}
          <div class="project-list">
            {#each projects as project, index}
              <a class="project-row" href={project.href}>
                <span class="project-number">{String(index + 1).padStart(2, '0')}</span>
                <span class="project-copy"><strong>{project.name}</strong><span>{project.description}</span></span>
                <span class="project-meta"><span>{project.status}</span><span>{project.meta}</span></span>
                <span class="project-arrow" aria-hidden="true">↗</span>
              </a>
            {/each}
          </div>
        {:else}
          <div class="state-panel"><strong>Nothing public yet.</strong><span>New projects will appear here as they leave the workbench.</span></div>
        {/if}
      </section>
    {/if}
  </main>

  <footer class="footer">
    <span>© {new Date().getFullYear()} Thieez</span>
    <span>Built independently · <a href={API_BASE}>{API_BASE.replace(/^https?:\/\//, '')}</a></span>
  </footer>
</div>
