<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import { getApkAsset, getDatabaseStorage, getLatestBuild, getLatestPluginBuild, getPluginZipAsset, getProjects, getRenderLimits, formatReleaseDate, API_BASE, subscribeToApiHeartbeat, subscribeToProjectUpdates, type ApiHeartbeatConnection, type DatabaseStorage, type LatestBuild, type LisnntoLimits, type Project, type RenderLimits, type RenderMetricSeries } from '$lib/api';
  import { addAdminAccessEntry, getAdminAccess, getLisnntoLimits, grantAdminAppAccess, kickAdminUser, logout, removeAdminAccessEntry, restoreAuth, revokeAdminAppAccess, startLogin, updateWhitelistSetting, type AdminAccessData, type AuthSession } from '$lib/auth-client';

  export let data: PageData;

  let isLisnnto = data.isLisnnto;
  let isNote = data.isNote;
  let projectName = data.projectName;
  let accessDenied = data.accessDenied;
  let accessCheckFailed = data.accessCheckFailed;
  let projects: Project[] = data.projects?.value?.projects ?? [];
  let build: LatestBuild | null = data.build?.value ?? null;
  let loading = false;
  let error = data.build?.value ? '' : data.build?.error ?? '';
  let projectError = data.projects?.value ? '' : data.projects?.error ?? '';
  let apiStatus: 'checking' | 'online' | 'degraded' | 'offline' =
    data.build?.stale || data.projects?.stale || data.projects?.value?.source === 'fallback'
      ? 'degraded'
      : data.build?.value || data.projects?.value
        ? 'online'
        : 'checking';
  const initialCacheResults: Array<
    [string, { stale: boolean; updatedAt: string | null; value: unknown } | null]
  > = [
    ['build', data.build],
    ['projects', data.projects],
    ['storage', data.storage],
    ['render', data.renderLimits]
  ];
  let staleDataResources = new Set(
    initialCacheResults.filter(([, result]) => result?.stale).map(([resource]) => resource)
  );
  let hasProjectsData = data.projects?.value !== null && data.projects?.value !== undefined;
  let authSession: AuthSession | null = null;
  let authLoading = true;
  let profileMenuOpen = false;
  let accountOpen = false;
  let adminOpen = data.isDashboard;
  let adminAccess: AdminAccessData | null = null;
  let adminLoading = data.isDashboard;
  let adminError = '';
  let adminMessage = '';
  let adminEmail = '';
  let adminReason = '';
  let adminAction: 'whitelist' | 'blacklist' | 'admin' = 'whitelist';
  let adminAppEmail = '';
  let adminAppSlug = '';
  let limits: LisnntoLimits | null = null;
  let limitsLoading = false;
  let limitsError = '';
  let storage: DatabaseStorage | null = data.storage?.value ?? null;
  let storageLoading = false;
  let storageError = storage ? '' : data.storage?.error ?? '';
  let authRefreshTimer: number | undefined;
  let heartbeatConnection: ApiHeartbeatConnection = 'connecting';
  let heartbeatMonitorWidth = 1200;
  let renderLimits: RenderLimits | null = data.renderLimits?.value ?? null;
  let renderLimitsLoading = false;
  let renderLimitsError = renderLimits ? '' : data.renderLimits?.error ?? '';

  const observeHeartbeatMonitor = (node: HTMLDivElement) => {
    const updateWidth = () => {
      heartbeatMonitorWidth = Math.max(1, Math.round(node.getBoundingClientRect().width));
    };
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    updateWidth();
    return { destroy: () => observer.disconnect() };
  };

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
    if (accessDenied || accessCheckFailed) {
      loading = false;
      return;
    }
    loading = isLisnnto || isNote ? build === null : !hasProjectsData;
    error = '';
    projectError = '';
    apiStatus = isLisnnto || isNote
      ? build ? 'online' : 'checking'
      : hasProjectsData ? 'online' : 'checking';

    if (isLisnnto || isNote) {
      try {
        build = isNote ? await getLatestPluginBuild() : await getLatestBuild();
        apiStatus = 'online';
      } catch (cause) {
        if (build) {
          apiStatus = 'degraded';
          markStale('build', true);
        } else {
          apiStatus = 'offline';
          error = cause instanceof Error ? cause.message : 'The latest build could not be loaded.';
        }
      }
    } else {
      storageLoading = storage === null;
      storageError = '';
      renderLimitsLoading = renderLimits === null;
      renderLimitsError = '';
      void getDatabaseStorage()
        .then((result) => {
          storage = result;
          markStale('storage', false);
        })
        .catch((cause) => {
          if (storage) markStale('storage', true);
          else storageError = cause instanceof Error ? cause.message : 'Database storage could not be loaded.';
        })
        .finally(() => {
          storageLoading = false;
        });
      void getRenderLimits()
        .then((result) => {
          renderLimits = result;
          markStale('render', false);
        })
        .catch((cause) => {
          if (renderLimits) markStale('render', true);
          else renderLimitsError = cause instanceof Error ? cause.message : 'Render limits could not be loaded.';
        })
        .finally(() => {
          renderLimitsLoading = false;
        });
      try {
        const result = await getProjects();
        projects = result.projects;
        hasProjectsData = true;
        markStale('projects', false);
        apiStatus = result.source === 'fallback' ? 'degraded' : 'online';
      } catch (cause) {
        if (hasProjectsData) {
          apiStatus = 'degraded';
          markStale('projects', true);
        } else {
          apiStatus = 'offline';
          projectError = cause instanceof Error ? cause.message : 'Projects could not be loaded.';
        }
      }
    }

    loading = false;
  };

  const markStale = (resource: string, stale: boolean) => {
    const resources = new Set(staleDataResources);
    if (stale) resources.add(resource);
    else resources.delete(resource);
    staleDataResources = resources;
  };

  onMount(() => {
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', handleDocumentKeydown);
    for (const [resource, result] of initialCacheResults) {
      if (
        result?.updatedAt &&
        Date.now() - new Date(result.updatedAt).getTime() > 60_000
      ) {
        markStale(resource, true);
      }
    }
    let unsubscribeProjects: () => void = () => undefined;
    let unsubscribeHeartbeat: () => void = () => undefined;
    if (!isLisnnto && !isNote) {
      unsubscribeHeartbeat = subscribeToApiHeartbeat((connection) => {
        heartbeatConnection = connection;
      });
    }
    void (async () => {
      const authTask = restoreAuth()
        .then((session) => {
          authSession = session;
          if (data.isDashboard) {
            if (session?.user?.is_admin === true) {
              adminOpen = true;
              void refreshAdminAccess();
            } else {
              void goto('/');
            }
          }
          if (session) {
            authRefreshTimer = window.setInterval(() => {
              void restoreAuth()
                .then((updatedSession) => {
                  authSession = updatedSession;
                  if (!updatedSession && authRefreshTimer !== undefined) {
                    window.clearInterval(authRefreshTimer);
                    authRefreshTimer = undefined;
                  }
                })
                .catch(() => {
                  authSession = null;
                });
            }, 15 * 60 * 1000);
          }
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
        unsubscribeProjects = subscribeToProjectUpdates(() => {
          void load();
        });
      }
    })();

    return () => {
      unsubscribeProjects();
      unsubscribeHeartbeat();
      if (authRefreshTimer !== undefined) window.clearInterval(authRefreshTimer);
      document.removeEventListener('click', closeMenus);
      document.removeEventListener('keydown', handleDocumentKeydown);
    };
  });

  const handleLogout = async () => {
    profileMenuOpen = false;
    accountOpen = false;
    adminOpen = false;
    try {
      await logout();
    } finally {
      authSession = null;
      limits = null;
      limitsError = '';
      if (authRefreshTimer !== undefined) window.clearInterval(authRefreshTimer);
    }
  };

  const toggleProfileMenu = async (event: MouseEvent) => {
    event.stopPropagation();
    if (profileMenuOpen) {
      profileMenuOpen = false;
      return;
    }
    try {
      const session = await restoreAuth();
      authSession = session;
      if (session?.user?.is_admin !== true) {
        adminOpen = false;
        adminAccess = null;
      }
      profileMenuOpen = Boolean(session);
    } catch {
      authSession = null;
      adminOpen = false;
      adminAccess = null;
      profileMenuOpen = false;
    }
  };

  const openAccount = async () => {
    profileMenuOpen = false;
    adminOpen = false;
    accountOpen = true;
    if (!authSession || limits || limitsLoading) return;
    limitsLoading = true;
    limitsError = '';
    try {
      limits = await getLisnntoLimits();
    } catch (cause) {
      limitsError = cause instanceof Error ? cause.message : 'Could not load Lisnnto limits.';
    } finally {
      limitsLoading = false;
    }
  };

  const refreshAdminAccess = async () => {
    adminLoading = true;
    adminError = '';
    try {
      adminAccess = await getAdminAccess();
      if (!adminAccess.apps.some((app) => app.slug === adminAppSlug)) {
        adminAppSlug = adminAccess.apps[0]?.slug ?? '';
      }
    } catch (cause) {
      adminError = cause instanceof Error ? cause.message : 'Could not load access settings.';
    } finally {
      adminLoading = false;
    }
  };

  const openAdmin = () => {
    profileMenuOpen = false;
    accountOpen = false;
    if (authSession?.user?.is_admin !== true) return;
    void goto('/dashboard');
  };

  const closeAdmin = () => {
    adminOpen = false;
    void goto('/');
  };

  const saveWhitelistSetting = async (enabled: boolean) => {
    adminError = '';
    adminMessage = '';
    try {
      await updateWhitelistSetting(enabled);
      if (adminAccess) adminAccess = { ...adminAccess, whitelist_enabled: enabled };
      adminMessage = 'Whitelist setting saved.';
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not update whitelist setting.';
      await refreshAdminAccess();
      adminError = message;
    }
  };

  const addAccessEntry = async (event: SubmitEvent) => {
    event.preventDefault();
    adminError = '';
    adminMessage = '';
    try {
      await addAdminAccessEntry(adminAction, adminEmail, adminReason);
      adminEmail = '';
      adminReason = '';
      adminMessage = adminAction === 'admin' ? 'Administrator permission granted.' : 'Access list updated.';
      await refreshAdminAccess();
    } catch (cause) {
      adminError = cause instanceof Error ? cause.message : 'Could not update user access.';
    }
  };

  const grantAppAccess = async (event: SubmitEvent) => {
    event.preventDefault();
    adminError = '';
    adminMessage = '';
    try {
      await grantAdminAppAccess(adminAppEmail, adminAppSlug);
      adminAppEmail = '';
      adminMessage = `Access granted to ${adminAccess?.apps.find((app) => app.slug === adminAppSlug)?.name ?? adminAppSlug}.`;
      await refreshAdminAccess();
    } catch (cause) {
      adminError = cause instanceof Error ? cause.message : 'Could not grant application access.';
    }
  };

  const removeAppAccess = async (userId: string, appSlug: string) => {
    adminError = '';
    adminMessage = '';
    try {
      await revokeAdminAppAccess(userId, appSlug);
      adminMessage = 'Application access revoked.';
      await refreshAdminAccess();
    } catch (cause) {
      adminError = cause instanceof Error ? cause.message : 'Could not revoke application access.';
    }
  };

  const removeAccessEntry = async (action: 'whitelist' | 'blacklist' | 'admin', identifier: string) => {
    adminError = '';
    adminMessage = '';
    try {
      await removeAdminAccessEntry(action, identifier);
      adminMessage = action === 'admin' ? 'Administrator permission removed.' : 'User removed from the list.';
      if (action === 'admin' && identifier === authSession?.user?.id) {
        authSession = await restoreAuth();
        if (authSession?.user?.is_admin !== true) {
          adminOpen = false;
          adminAccess = null;
          return;
        }
      }
      await refreshAdminAccess();
    } catch (cause) {
      adminError = cause instanceof Error ? cause.message : 'Could not remove user access.';
    }
  };

  const kickOnlineUser = async (userId: string, blacklist = false) => {
    const actionLabel = blacklist ? 'blacklist and sign out' : 'sign out';
    if (!window.confirm(`Are you sure you want to ${actionLabel} this user?`)) return;
    adminError = '';
    adminMessage = '';
    try {
      await kickAdminUser(userId, blacklist);
      adminMessage = blacklist
        ? 'User added to the blacklist and signed out.'
        : 'User signed out from all devices.';
      await refreshAdminAccess();
    } catch (cause) {
      adminError = cause instanceof Error ? cause.message : 'Could not sign out user.';
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

  type ChartPoint = { timestamp: string; value: number };
  type RenderMetricName = 'cpu' | 'cpu_limit' | 'memory' | 'memory_limit' | 'bandwidth' | 'http_requests' | 'http_latency' | 'disk_usage' | 'disk_capacity' | 'active_connections';
  const metricDefinitions: Array<{ name: RenderMetricName; label: string; limit?: RenderMetricName; aggregate: 'average' | 'sum' }> = [
    { name: 'memory', label: 'Memory utilization', limit: 'memory_limit', aggregate: 'average' }
  ];

  const seriesFor = (series: RenderMetricSeries[] | undefined, aggregate: 'average' | 'sum'): ChartPoint[] => {
    const buckets = new Map<string, number[]>();
    for (const item of series ?? []) {
      for (const point of item.values ?? []) {
        if (!point.timestamp || typeof point.value !== 'number' || !Number.isFinite(point.value)) continue;
        const values = buckets.get(point.timestamp) ?? [];
        values.push(point.value);
        buckets.set(point.timestamp, values);
      }
    }
    return [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([timestamp, values]) => ({
        timestamp,
        value: aggregate === 'sum'
          ? values.reduce((total, value) => total + value, 0)
          : values.reduce((total, value) => total + value, 0) / values.length
      }));
  };

  const latestValue = (points: ChartPoint[]): number | undefined => points.at(-1)?.value;
  const metricUnit = (series: RenderMetricSeries[] | undefined): string => series?.find((item) => item.unit)?.unit ?? '';
  const formatMetricValue = (value: number | undefined, unit: string): string => {
    if (value === undefined) return '—';
    if (unit === 'bytes') return formatBytes(value);
    if (unit === 'percent') return `${value.toFixed(1)}%`;
    if (unit === 'seconds') return `${value.toFixed(2)} s`;
    if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (Math.abs(value) < 1) return value.toFixed(3);
    return value.toFixed(1);
  };
  const chartPath = (points: ChartPoint[], max: number): string => {
    if (!points.length) return '';
    return points.map((point, index) => {
      const x = points.length === 1 ? 0 : index / (points.length - 1) * 100;
      const y = 38 - Math.min(1, Math.max(0, point.value / max)) * 34;
      return `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  };
  const metricPoints = (name: RenderMetricName, aggregate: 'average' | 'sum'): ChartPoint[] =>
    seriesFor(renderLimits?.metric_series?.[name], aggregate);

  const availableMetricDefinitions = (): typeof metricDefinitions =>
    metricDefinitions.filter((definition) => metricPoints(definition.name, definition.aggregate).length > 0);

  const heartbeatCycleWidth = (): number =>
    heartbeatMonitorWidth / Math.max(1, Math.floor(heartbeatMonitorWidth / 120));
  const heartbeatSweepWidth = (): number => Math.max(100, Math.round(heartbeatMonitorWidth * 0.18));
  const heartbeatSweepDuration = (): string =>
    ((heartbeatMonitorWidth + 2 * heartbeatSweepWidth() + 36) / 150).toFixed(2);
  const heartbeatAnimationDuration = (): string => (heartbeatCycleWidth() / 150).toFixed(2);
  const prefersReducedMotion = () => browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const heartbeatPulsePath = (monitorWidth: number): string => {
    const segments: string[] = [];
    const cycleWidth = heartbeatCycleWidth();
    const firstBeat = cycleWidth * 0.11875;
    for (let x = firstBeat; x < monitorWidth; x += cycleWidth) {
      const at = (fraction: number) => x + cycleWidth * fraction;
      segments.push(
        `M${at(0.2375)} 60 Q${at(0.275)} 60 ${at(0.3)} 54 H${at(0.3375)} L${at(0.38125)} 14 L${at(0.425)} 105 L${at(0.475)} 60 Q${at(0.5125)} 60 ${at(0.55)} 53 Q${at(0.5875)} 60 ${at(0.6375)} 60`
      );
    }
    return segments.join(' ');
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
              onclick={toggleProfileMenu}
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
                {#if authSession.user?.is_admin === true}
                  <button class="profile-dropdown-item" onclick={openAdmin}>
                    <span>Dashboard</span><span aria-hidden="true">↗</span>
                  </button>
                {/if}
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
  {#if staleDataResources.size}
    <div class="stale-notice" role="status">
      Showing cached data because the API could not be reached. The information may be out of date.
    </div>
  {/if}

  <main class="main-content">
    {#if accessDenied}
      <section class="account-view" aria-labelledby="access-denied-heading">
        <p class="eyebrow">THIEEZ / {projectName.toUpperCase()}</p>
        <h1 id="access-denied-heading">No access <em>yet.</em></h1>
        <p class="lede">Your account hasn’t been granted access to {projectName}.</p>
        <a class="text-button" href="https://thieez.com/">Back to Thieez <span aria-hidden="true">↗</span></a>
      </section>
    {:else if accessCheckFailed}
      <section class="account-view" aria-labelledby="access-check-heading">
        <p class="eyebrow">THIEEZ / {projectName.toUpperCase()}</p>
        <h1 id="access-check-heading">Access check <em>unavailable.</em></h1>
        <p class="lede">We couldn’t verify access right now. Please try again shortly.</p>
        <a class="text-button" href="https://thieez.com/">Back to Thieez <span aria-hidden="true">↗</span></a>
      </section>
    {:else if adminOpen}
      <section class="account-view admin-view" aria-labelledby="admin-heading">
        <div class="account-topline">
          <p class="eyebrow">THIEEZ / DASHBOARD</p>
          <button class="text-button" onclick={closeAdmin}>Close <span aria-hidden="true">×</span></button>
        </div>
        <h1 id="admin-heading">Access <em>control.</em></h1>
        <p class="lede">Manage API access and administrator permissions. Changes take effect immediately.</p>
        {#if adminError}
          <div class="state-panel error-panel admin-feedback" role="alert">
            <strong>Couldn’t update access settings.</strong><span>{adminError}</span>
            <button class="text-button" onclick={refreshAdminAccess}>Try again</button>
          </div>
        {:else if adminMessage}
          <div class="state-panel admin-feedback" role="status">{adminMessage}</div>
        {/if}
        {#if adminLoading && !adminAccess}
          <div class="state-panel" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Loading access settings…</span></div>
        {:else if adminAccess}
          <label class="admin-toggle">
            <span><strong>Require whitelist</strong><small>Only listed accounts and administrators can access authenticated API features.</small></span>
            <input
              type="checkbox"
              checked={adminAccess.whitelist_enabled}
              onchange={(event) => void saveWhitelistSetting(event.currentTarget.checked)}
            />
          </label>
          <form class="admin-entry-form" onsubmit={addAccessEntry}>
            <label>
              <span>Email address</span>
              <input type="email" bind:value={adminEmail} required autocomplete="off" placeholder="person@example.com" />
            </label>
            <label>
              <span>Permission</span>
              <select bind:value={adminAction}>
                <option value="whitelist">Add to whitelist</option>
                <option value="blacklist">Add to blacklist</option>
                <option value="admin">Grant administrator</option>
              </select>
            </label>
            {#if adminAction !== 'admin'}
              <label>
                <span>Reason <small>(optional)</small></span>
                <input type="text" bind:value={adminReason} maxlength="500" placeholder="Internal note" />
              </label>
            {/if}
            <button class="admin-submit" type="submit">Save permission <span aria-hidden="true">↗</span></button>
          </form>
          <section class="admin-app-access">
            <div class="section-heading">
              <h2>Application access</h2>
              <span>Published Thieez repositories</span>
            </div>
            <form class="admin-entry-form" onsubmit={grantAppAccess}>
              <label>
                <span>Email address</span>
                <input type="email" bind:value={adminAppEmail} required autocomplete="off" placeholder="person@example.com" />
              </label>
              <label>
                <span>Application</span>
                <select bind:value={adminAppSlug} required disabled={!adminAccess.apps.length}>
                  {#each adminAccess.apps as app (app.slug)}
                    <option value={app.slug}>{app.name}</option>
                  {/each}
                </select>
              </label>
              <button class="admin-submit" type="submit" disabled={!adminAccess.apps.length}>
                Grant access <span aria-hidden="true">↗</span>
              </button>
            </form>
            {#if adminAccess.app_access.length}
              {#each adminAccess.app_access as entry (`${entry.user_id}:${entry.app_slug}`)}
                <div class="admin-list-row">
                  <span>
                    <strong>{entry.email || entry.user_id}</strong>
                    <small>{adminAccess.apps.find((app) => app.slug === entry.app_slug)?.name ?? entry.app_slug}</small>
                  </span>
                  <button class="text-button" onclick={() => void removeAppAccess(entry.user_id, entry.app_slug)}>Revoke</button>
                </div>
              {/each}
            {:else}
              <p class="admin-empty">No application-specific access has been granted.</p>
            {/if}
          </section>
          <div class="admin-lists">
            <section class="admin-online-section">
              <div class="section-heading">
                <h2>Online users</h2>
                <span>{adminAccess.online_users.length} active</span>
                <button class="text-button" onclick={refreshAdminAccess}>Refresh</button>
              </div>
              {#if adminAccess.online_users.length}
                {#each adminAccess.online_users as onlineUser (onlineUser.user_id)}
                  <div class="admin-list-row">
                    <span>
                      <strong>{onlineUser.email || onlineUser.user_id}</strong>
                      <small>
                        {onlineUser.name ? `${onlineUser.name} · ` : ''}Active {new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(onlineUser.last_active_at))}
                      </small>
                    </span>
                    {#if onlineUser.user_id !== authSession?.user?.id}
                      <div class="admin-online-actions">
                        <button class="text-button" onclick={() => void kickOnlineUser(onlineUser.user_id)}>Kick</button>
                        <button class="text-button admin-block-button" onclick={() => void kickOnlineUser(onlineUser.user_id, true)}>Blacklist + kick</button>
                      </div>
                    {:else}
                      <span class="admin-self-label">You</span>
                    {/if}
                  </div>
                {/each}
              {:else}<p class="admin-empty">No users are online.</p>{/if}
            </section>
            <section>
              <div class="section-heading"><h2>Whitelist</h2><span>{adminAccess.whitelist.length} accounts</span></div>
              {#if adminAccess.whitelist.length}
                {#each adminAccess.whitelist as entry (entry.email)}
                  <div class="admin-list-row">
                    <span><strong>{entry.email}</strong>{#if entry.reason}<small>{entry.reason}</small>{/if}</span>
                    <button class="text-button" onclick={() => void removeAccessEntry('whitelist', entry.email)}>Remove</button>
                  </div>
                {/each}
              {:else}<p class="admin-empty">No accounts listed.</p>{/if}
            </section>
            <section>
              <div class="section-heading"><h2>Blacklist</h2><span>{adminAccess.blacklist.length} accounts</span></div>
              {#if adminAccess.blacklist.length}
                {#each adminAccess.blacklist as entry (entry.email)}
                  <div class="admin-list-row">
                    <span><strong>{entry.email}</strong>{#if entry.reason}<small>{entry.reason}</small>{/if}</span>
                    <button class="text-button" onclick={() => void removeAccessEntry('blacklist', entry.email)}>Remove</button>
                  </div>
                {/each}
              {:else}<p class="admin-empty">No accounts listed.</p>{/if}
            </section>
            <section>
              <div class="section-heading"><h2>Administrators</h2><span>{adminAccess.admins.length} assigned</span></div>
              {#if adminAccess.admins.length}
                {#each adminAccess.admins as admin (admin.user_id)}
                  <div class="admin-list-row">
                    <span><strong>{admin.email || admin.user_id}</strong>{#if admin.name}<small>{admin.name}</small>{/if}</span>
                    <button class="text-button" onclick={() => void removeAccessEntry('admin', admin.user_id)}>Revoke</button>
                  </div>
                {/each}
              {:else}<p class="admin-empty">No database-assigned administrators.</p>{/if}
            </section>
          </div>
        {/if}
      </section>
    {:else if accountOpen}
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

      <section class="health-section" aria-labelledby="health-heading">
        <div class="section-heading">
          <h2 id="health-heading">API heartbeat</h2>
        </div>
        <div class="heartbeat-card">
          <div class="heartbeat-summary" aria-live="polite" aria-atomic="true">
            <div>
              <span>API connection</span>
              <strong
                role="status"
                class:heartbeat-status-up={heartbeatConnection === 'connected'}
                class:heartbeat-status-down={heartbeatConnection === 'disconnected'}
                class:heartbeat-status-paused={heartbeatConnection === 'connecting'}
              >{heartbeatConnection === 'connected' ? 'Connected' : heartbeatConnection === 'disconnected' ? 'No heartbeat' : 'Connecting…'}</strong>
            </div>
            <div>
              <span>Heartbeat source</span>
              <strong>Direct API</strong>
            </div>
          </div>
          <div class="heartbeat-monitor" use:observeHeartbeatMonitor aria-live="polite">
            <svg viewBox={`0 0 ${heartbeatMonitorWidth} 120`} preserveAspectRatio="none" role="img" aria-label={heartbeatConnection === 'connected' ? 'Live API heartbeat received directly over WebSocket' : heartbeatConnection === 'disconnected' ? 'No heartbeat; API WebSocket is unavailable' : 'Connecting directly to the API heartbeat'}>
              {#if heartbeatConnection === 'connected'}
                <path class="heartbeat-trace-up heartbeat-trace-dim" d={`M0 60 H${heartbeatMonitorWidth}`} aria-hidden="true" />
                {#if !prefersReducedMotion()}
                  <defs>
                    <linearGradient id="heartbeat-sweep-gradient">
                      <stop offset="0%" stop-color="white" stop-opacity="0" />
                      <stop offset="35%" stop-color="white" stop-opacity=".35" />
                      <stop offset="65%" stop-color="white" />
                      <stop offset="100%" stop-color="white" stop-opacity="0" />
                    </linearGradient>
                    <mask id="heartbeat-sweep-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={heartbeatMonitorWidth} height="120">
                      <rect width={heartbeatMonitorWidth} height="120" fill="black" />
                      <rect y="0" width={heartbeatSweepWidth()} height="120" fill="url(#heartbeat-sweep-gradient)">
                        <animate
                          attributeName="x"
                          from={-heartbeatSweepWidth() - 18}
                          to={heartbeatMonitorWidth + 18}
                          dur={`${heartbeatSweepDuration()}s`}
                          repeatCount="indefinite"
                        />
                      </rect>
                    </mask>
                  </defs>
                  <path class="heartbeat-trace-cut" d={heartbeatPulsePath(heartbeatMonitorWidth)} mask="url(#heartbeat-sweep-mask)" aria-hidden="true" />
                  <path class="heartbeat-trace-up" d={heartbeatPulsePath(heartbeatMonitorWidth)} mask="url(#heartbeat-sweep-mask)" aria-hidden="true" />
                {/if}
              {:else}
                {#if heartbeatConnection === 'disconnected'}
                  <path class="heartbeat-trace-down heartbeat-trace-dim" d={`M0 60 H${heartbeatMonitorWidth}`} />
                {/if}
                <path
                  class:heartbeat-trace-down={heartbeatConnection === 'disconnected'}
                  class:heartbeat-trace-paused={heartbeatConnection === 'connecting'}
                  d={`M0 60 H${heartbeatMonitorWidth}`}
                  pathLength="1000"
                  stroke-dasharray={heartbeatConnection === 'disconnected' && !prefersReducedMotion() ? '90 910' : undefined}
                >
                  {#if heartbeatConnection === 'disconnected' && !prefersReducedMotion()}
                    <animate
                      attributeName="stroke-dashoffset"
                      from="0"
                      to="-1000"
                      dur={`${heartbeatAnimationDuration()}s`}
                      repeatCount="indefinite"
                    />
                  {/if}
                </path>
              {/if}
            </svg>
          </div>
          <div class="heartbeat-legend" aria-live="polite" aria-atomic="true">
            {#if heartbeatConnection === 'connected'}
              <span><i class="heartbeat-up"></i>Heartbeat received directly from the API</span>
            {:else}
              <span><i class={heartbeatConnection === 'disconnected' ? 'heartbeat-down' : 'heartbeat-paused'}></i>{heartbeatConnection === 'disconnected' ? 'No heartbeat from the API' : 'Waiting for API heartbeat'}</span>
            {/if}
          </div>
        </div>
      </section>
      <div class="infrastructure-grid">
        <section class="storage-section" aria-labelledby="storage-heading">
          <div class="section-heading">
            <h2 id="storage-heading">Database storage</h2>
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
          </div>
          {#if renderLimitsLoading}
            <div class="state-panel" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Checking Render plan limits…</span></div>
          {:else if renderLimitsError}
            <div class="state-panel error-panel" role="alert"><strong>Render plan is unavailable.</strong><span>{renderLimitsError}</span></div>
          {:else if renderLimits}
            <div class="storage-card">
              <div class="render-metric-grid">
                {#each availableMetricDefinitions() as definition}
                  {@const points = metricPoints(definition.name, definition.aggregate)}
                  {@const limitPoints = definition.limit ? metricPoints(definition.limit, 'average') : []}
                  {@const current = latestValue(points)}
                  {@const limit = latestValue(limitPoints)}
                  {@const unit = metricUnit(renderLimits.metric_series?.[definition.name])}
                  {@const chartMax = Math.max(...points.map((point) => point.value), ...(limit !== undefined ? [limit] : []), 1)}
                  <article class="render-metric">
                    <div class="render-metric-data">
                      <div class="render-metric-heading">
                        <span>{definition.label}</span>
                        <strong>{formatMetricValue(current, unit)}</strong>
                      </div>
                      {#if limit !== undefined}
                        <div class="metric-bar" role="progressbar" aria-label={`${definition.label} usage`} aria-valuemin="0" aria-valuemax={limit} aria-valuenow={current ?? 0}>
                          <span style={`width: ${Math.min(100, Math.max(0, (current ?? 0) / Math.max(limit, 0.000001) * 100))}%`}></span>
                        </div>
                        <small>{formatMetricValue(limit, metricUnit(renderLimits.metric_series?.[definition.limit!]))} limit</small>
                      {/if}
                    </div>
                    {#if points.length}
                      <div class="render-metric-history">
                        <svg class="metric-chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${definition.label} over time`}>
                          <path d={chartPath(points, chartMax)} />
                        </svg>
                        <small>{points.length} points · {points[0].timestamp} — {points.at(-1)?.timestamp}</small>
                      </div>
                    {/if}
                  </article>
                {/each}
              </div>
            </div>
          {/if}
        </section>
      </div>

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
              <a class="project-row" href={`/projects/${encodeURIComponent(project.slug)}`}>
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
