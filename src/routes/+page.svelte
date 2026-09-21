<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { getApkAsset, getDatabaseStorage, getLatestBuild, getLatestPluginBuild, getPluginZipAsset, getProjects, getRenderLimits, formatReleaseDate, API_BASE, getLisnntoLimits, logout, restoreAuth, startLogin, subscribeToProjectUpdates, type AuthSession, type DatabaseStorage, type LatestBuild, type LisnntoLimits, type Project, type RenderLimits } from '$lib/api';

  let isLisnnto = false;
  let isNote = false;
  let projectName = '';
  let projects: Project[] = [];
  let build: LatestBuild | null = null;
  let loading = true;
  let error = '';
  let projectError = '';
  let apiStatus: 'checking' | 'online' | 'degraded' | 'offline' = 'checking';
  let authSession: AuthSession | null = null;
  let authLoading = true;
  let profileMenuOpen = false;
  let accountOpen = false;
  let limits: LisnntoLimits | null = null;
  let limitsLoading = false;
  let limitsError = '';
  let storage: DatabaseStorage | null = null;
  let storageLoading = false;
  let storageError = '';
  let renderLimits: RenderLimits | null = null;
  let renderLimitsLoading = false;
  let renderLimitsError = '';

  const detectExperience = () => {
    if (!browser) return;
    const params = new URLSearchParams(window.location.search);
    const hostname = window.location.hostname.toLowerCase();
    const hostProject = hostname.endsWith('.thieez.com')
      ? hostname.slice(0, -'.thieez.com'.length)
      : '';
    const configuredProject = params.get('project')?.trim().toLowerCase() || '';
    const projectSlug = configuredProject || (hostProject !== 'www' && hostProject !== 'api' ? hostProject : '');
    projectName = projectSlug
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    isLisnnto = projectSlug === 'lisnnto';
    isNote = projectSlug === 'note';
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
      storageLoading = true;
      storageError = '';
      renderLimitsLoading = true;
      renderLimitsError = '';
      void getDatabaseStorage()
        .then((result) => {
          storage = result;
        })
        .catch((cause) => {
          storageError = cause instanceof Error ? cause.message : 'Database storage could not be loaded.';
        })
        .finally(() => {
          storageLoading = false;
        });
      void getRenderLimits()
        .then((result) => {
          renderLimits = result;
        })
        .catch((cause) => {
          renderLimitsError = cause instanceof Error ? cause.message : 'Render limits could not be loaded.';
        })
        .finally(() => {
          renderLimitsLoading = false;
        });
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
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', handleDocumentKeydown);
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

    return () => {
      unsubscribe();
      document.removeEventListener('click', closeMenus);
      document.removeEventListener('keydown', handleDocumentKeydown);
    };
  });

  const handleLogout = async () => {
    profileMenuOpen = false;
    accountOpen = false;
    await logout(authSession);
    authSession = null;
    limits = null;
    limitsError = '';
  };

  const openAccount = async () => {
    profileMenuOpen = false;
    accountOpen = true;
    if (!authSession || limits || limitsLoading) return;
    limitsLoading = true;
    limitsError = '';
    try {
      limits = await getLisnntoLimits(authSession.accessToken);
    } catch (cause) {
      limitsError = cause instanceof Error ? cause.message : 'Could not load Lisnnto limits.';
    } finally {
      limitsLoading = false;
    }
  };

  const closeMenus = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('.profile-menu')) return;
    profileMenuOpen = false;
  };

  const handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      profileMenuOpen = false;
      accountOpen = false;
    }
  };

  $: userLabel = authSession?.user?.name || authSession?.user?.email || 'Account';
  $: userInitial = userLabel.trim().charAt(0).toUpperCase() || 'A';
  $: avatarUrl = authSession?.user?.avatar_url;

  $: apk = build ? getApkAsset(build) : undefined;
  $: pluginZip = build && isNote ? getPluginZipAsset(build) : undefined;

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatMetric = (metric: { value: number; unit?: string } | null | undefined): string => {
    if (!metric) return '—';
    const value = Number(metric.value);
    if (!Number.isFinite(value)) return '—';
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)}${metric.unit ? ` ${metric.unit}` : ''}`;
  };

  const metricPath = (points: Array<{ value: number }> | undefined): string => {
    if (!points?.length) return '';
    const values = points.map((point) => Number(point.value)).filter(Number.isFinite);
    if (!values.length) return '';
    const max = Math.max(...values, 1);
    return values.map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 36 - (value / max) * 32;
      return `${index ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  };
</script>

<svelte:head>
  <title>{isLisnnto ? 'Lisnnto — Thieez' : isNote ? 'Note — Thieez' : 'Thieez — Things we’re building'}</title>
  <meta name="description" content="Independent software projects from Thieez." />
</svelte:head>

<div class="site-shell">
  <header class="masthead">
    <a class="wordmark" href="https://thieez.com/">
      {#if projectName}<span class="project-word">{projectName}</span>{/if}<span
          class:status-online={apiStatus === 'online'}
          class:status-degraded={apiStatus === 'degraded'}
          class:status-offline={apiStatus === 'offline'}
          class="status-dot"
          role="img"
          aria-label={`API status: ${apiStatus}`}
          title={`API status: ${apiStatus}`}
        ></span><span>Thieez</span>
    </a>
    <div class="header-meta">
      {#if !authLoading}
        {#if authSession}
          <div class="profile-menu">
            <button
              class="profile-button"
              class:profile-button-open={profileMenuOpen}
              aria-label={`Open profile menu for ${userLabel}`}
              aria-expanded={profileMenuOpen}
              onclick={(event) => { event.stopPropagation(); profileMenuOpen = !profileMenuOpen; }}
            >
              {#if avatarUrl}
                <img src={avatarUrl} alt="" class="profile-avatar" />
              {:else}
                <span class="profile-avatar profile-avatar-fallback" aria-hidden="true">{userInitial}</span>
              {/if}
            </button>
            {#if profileMenuOpen}
              <div class="profile-dropdown">
                <div class="profile-heading">
                  <strong>{userLabel}</strong>
                  {#if authSession.user?.email && authSession.user.email !== userLabel}
                    <span>{authSession.user.email}</span>
                  {/if}
                </div>
                <button class="profile-dropdown-item" onclick={openAccount}>
                  <span>Account</span><span aria-hidden="true">↗</span>
                </button>
                <button class="profile-dropdown-item profile-dropdown-logout" onclick={handleLogout}>
                  <span>Log out</span><span aria-hidden="true">↗</span>
                </button>
              </div>
            {/if}
          </div>
        {:else}
          <button class="auth-button" onclick={startLogin}>Log in with Google</button>
        {/if}
      {/if}
    </div>
  </header>

  <main class="main-content">
    {#if accountOpen}
      <section class="account-view" aria-labelledby="account-heading">
        <div class="account-topline">
          <p class="eyebrow">THIEEZ / ACCOUNT</p>
          <button class="text-button" onclick={() => accountOpen = false}>Close <span aria-hidden="true">×</span></button>
        </div>
        <h1 id="account-heading">Your <em>account.</em></h1>
        <p class="lede">Usage and storage limits for your Lisnnto account.</p>
        {#if limitsLoading}
          <div class="state-panel" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Loading Lisnnto limits…</span></div>
        {:else if limitsError}
          <div class="state-panel error-panel" role="alert">
            <strong>Couldn’t load your limits.</strong>
            <span>{limitsError}</span>
            <button class="text-button" onclick={openAccount}>Try again <span aria-hidden="true">↗</span></button>
          </div>
        {:else if limits}
          <div class="limits-grid">
            <div class="limit-card">
              <span class="limit-label">Saved tracks</span>
              <strong>{limits.tracks_count} <small>/ {limits.tracks_limit}</small></strong>
              <span class="limit-progress"><span style={`width: ${Math.min(100, (limits.tracks_count / Math.max(1, limits.tracks_limit)) * 100)}%`}></span></span>
            </div>
            <div class="limit-card">
              <span class="limit-label">Playlists</span>
              <strong>{limits.playlists_count} <small>/ {limits.playlists_limit}</small></strong>
              <span class="limit-progress"><span style={`width: ${Math.min(100, (limits.playlists_count / Math.max(1, limits.playlists_limit)) * 100)}%`}></span></span>
            </div>
          </div>
          <p class="limits-note">Limits adjust automatically as shared Lisnnto storage fills up.</p>
        {/if}
      </section>
    {:else if isLisnnto || isNote}
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

      <section class="storage-section" aria-labelledby="storage-heading">
        <div class="section-heading">
          <h2 id="storage-heading">Database storage</h2>
          <span>SUPABASE / LIVE</span>
        </div>
        {#if storageLoading}
          <div class="state-panel" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Checking database capacity…</span></div>
        {:else if storageError}
          <div class="state-panel error-panel" role="alert"><strong>Storage status is unavailable.</strong><span>{storageError}</span></div>
        {:else if storage}
          <div class="storage-card">
            <div class="storage-values">
              <div><span>Used</span><strong>{formatBytes(storage.used_bytes)}</strong></div>
              <div><span>Available</span><strong>{formatBytes(storage.available_bytes)}</strong></div>
              <div><span>Total</span><strong>{formatBytes(storage.quota_bytes)}</strong></div>
            </div>
            <div class="storage-progress" role="progressbar" aria-label="Database storage used" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(storage.usage_ratio * 100)}>
              <span style={`width: ${Math.min(100, storage.usage_ratio * 100)}%`}></span>
            </div>
            <p>{Math.round(storage.usage_ratio * 100)}% of the configured database quota is currently used.</p>
          </div>
        {/if}
      </section>

      <section class="render-section" aria-labelledby="render-heading">
        <div class="section-heading">
          <h2 id="render-heading">API hosting</h2>
          <span>RENDER.COM / PLAN</span>
        </div>
        {#if renderLimitsLoading}
          <div class="state-panel" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Checking Render plan limits…</span></div>
        {:else if renderLimitsError}
          <div class="state-panel error-panel" role="alert"><strong>Render plan is unavailable.</strong><span>{renderLimitsError}</span></div>
        {:else if renderLimits}
          <div class="storage-card">
            <div class="storage-values render-values">
              <div><span>Plan</span><strong>{renderLimits.plan}</strong></div>
              <div><span>CPU</span><strong>{renderLimits.limits.cpu_cores != null ? `${renderLimits.limits.cpu_cores} core` : '—'}</strong></div>
              <div><span>Memory</span><strong>{renderLimits.limits.memory_mb != null ? `${renderLimits.limits.memory_mb} MB` : '—'}</strong></div>
              <div><span>Disk</span><strong>{renderLimits.limits.disk_gb != null ? `${renderLimits.limits.disk_gb} GB` : '—'}</strong></div>
            </div>
            <div class="render-details">
              <span>Status: {renderLimits.status || '—'}</span>
              <span>CPU now: {formatMetric(renderLimits.metrics?.cpu)}</span>
              <span>CPU limit: {formatMetric(renderLimits.metrics?.cpu_limit)}</span>
              <span>Memory now: {formatMetric(renderLimits.metrics?.memory)}</span>
              <span>Memory limit: {formatMetric(renderLimits.metrics?.memory_limit)}</span>
              <span>Instances: {renderLimits.instance_count ?? '—'}</span>
              <span>HTTP requests: {formatMetric(renderLimits.metrics?.http_requests)}</span>
              <span>HTTP latency: {formatMetric(renderLimits.metrics?.http_latency)}</span>
              <span>Bandwidth: {formatMetric(renderLimits.metrics?.bandwidth)}</span>
              <span>Disk used: {formatMetric(renderLimits.metrics?.disk_usage)}</span>
              <span>Disk capacity: {formatMetric(renderLimits.metrics?.disk_capacity)}</span>
              <span>Active connections: {formatMetric(renderLimits.metrics?.active_connections)}</span>
              <span>Running instances: {renderLimits.instances.length}</span>
            </div>
            <div class="metric-charts">
              {#each [['cpu', 'CPU utilization'], ['memory', 'Memory utilization'], ['bandwidth', 'Outbound bandwidth']] as chart}
                {@const points = renderLimits.metric_series?.[chart[0]]}
                <div class="metric-chart">
                  <span>{chart[1]}</span>
                  {#if points?.length}
                    <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${chart[1]} over the last 48 hours`}>
                      <path d={metricPath(points)} />
                    </svg>
                  {:else}
                    <small>No data returned by Render</small>
                  {/if}
                </div>
              {/each}
            </div>
            <p>{renderLimits.service_name}{renderLimits.runtime ? ` · ${renderLimits.runtime}` : ''}{renderLimits.region ? ` · ${renderLimits.region}` : ''}{renderLimits.latest_deploy?.status ? ` · deploy ${renderLimits.latest_deploy.status}` : ''}</p>
          </div>
        {/if}
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
