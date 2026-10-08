<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import { getApkAsset, getLatestBuild, getLatestPluginBuild, getPluginZipAsset, getProjects, formatReleaseDate, API_BASE, subscribeToApiHeartbeat, subscribeToProjectUpdates, type ApiHeartbeatConnection, type DatabaseStorage, type LatestBuild, type LisnntoLimits, type Project, type RenderLimits, type RenderMetricSeries } from '$lib/api';
  import { addAdminAccessEntry, createUserApiKey, getAdminAccess, getAdminUserDevices, getAlphaAccessStatus, getLisnntoLimits, getProjectAccess, getUserApiKeys, grantAdminAppAccess, kickAdminUser, logout, removeAdminAccessEntry, removeAdminDeviceTrust, restoreAuth, revokeAdminAppAccess, revokeUserApiKey, sendPresenceHeartbeat, setAdminAllProjectsAccess, signOutAdminDevice, startLogin, updateAdminAlphaRequest, updateWhitelistSetting, type AdminAccessData, type AdminDevice, type AlphaAccessStatus, type AuthSession, type ProjectAccessStatus, type UserApiKey } from '$lib/auth-client';

  export let data: PageData;

  type AdminDevicePanelState = {
    loading: boolean;
    error: string;
    devices: AdminDevice[] | null;
  };

  let isLisnnto = data.isLisnnto;
  let isNote = data.isNote;
  let projectSlug = data.projectSlug;
  let projectName = data.projectName;
  let accessDenied = data.accessDenied;
  let accessCheckFailed = data.accessCheckFailed;
  let projects: Project[] = data.projects?.value?.projects ?? [];
  let build: LatestBuild | null = data.build?.value ?? null;
  let loading = false;
  let projectRefresh: Promise<void> | null = null;
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
  let dashboardAuthError = '';
  let accountAuthError = '';
  let profileMenuOpen = false;
  let accountOpen = data.isAccount;
  let adminOpen = false;
  let adminAccess: AdminAccessData | null = null;
  let adminLoading = false;
  let adminEntrySaving = false;
  let whitelistSaving = false;
  let adminError = '';
  let adminMessage = '';
  let userApiKeys: UserApiKey[] = [];
  let apiKeysLoading = false;
  let apiKeyCreating = false;
  let apiKeysError = '';
  let apiKeysMessage = '';
  let apiKeyName = '';
  let pendingApiKeySequence = 0;
  let createdApiKey = '';
  let presenceHeartbeatTimer: number | undefined;
  let adminRosterRefreshTimer: number | undefined;
  let adminEmail = '';
  let adminReason = '';
  let adminAction: 'whitelist' | 'blacklist' | 'admin' = 'whitelist';
  let adminUserSearch = '';
  let adminUserPage = 1;
  let expandedAdminUsers = new Set<string>();
  let expandedDeviceUsers = new Set<string>();
  let adminDevicePanels: Record<string, AdminDevicePanelState> = {};
  let pendingDeviceActions = new Set<string>();
  let deviceActionErrors: Record<string, string> = {};
  let deviceActionMessages: Record<string, string> = {};
  let pendingAppGrants = new Set<string>();
  let pendingAlphaActions = new Set<string>();
  let alphaActionErrors: Record<string, string> = {};
  let alphaActionMessages: Record<string, string> = {};
  let appGrantErrors: Record<string, string> = {};
  let appGrantMessages: Record<string, string> = {};
  let limits: LisnntoLimits | null = null;
  let limitsLoading = false;
  let limitsError = '';
  let projectAccess: ProjectAccessStatus | null = null;
  let projectAccessLoading = false;
  let projectAccessError = '';
  let alphaAccess: AlphaAccessStatus | null = null;
  let alphaAccessLoading = false;
  let alphaAccessError = '';
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
    projectSlug = configuredProject || (hostProject !== 'www' && hostProject !== 'api' ? hostProject : '');
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
    if ((!isLisnnto && !isNote) || loading) return;
    if (accessDenied || accessCheckFailed) {
      loading = false;
      return;
    }
    loading = build === null;
    error = '';
    apiStatus = build ? 'online' : 'checking';

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

    loading = false;
  };

  const refreshProjects = async () => {
    if (projectRefresh) return projectRefresh;

    const refresh = (async () => {
      loading = !hasProjectsData;
      if (!hasProjectsData) apiStatus = 'checking';
      projectError = '';
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
      } finally {
        loading = false;
        projectRefresh = null;
      }
    })();
    projectRefresh = refresh;

    return refresh;
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
        if (data.isDashboard || data.isAccount) {
          apiStatus = connection === 'connected'
            ? 'online'
            : connection === 'disconnected'
              ? 'offline'
              : 'checking';
        }
      });
    }
    void (async () => {
      const authTask = restoreAuth()
        .then((session) => {
          authSession = session;
          if (data.isAccount && session) void loadAccountDetails();
          if (data.isDashboard) {
            if (session) {
              dashboardAuthError = '';
              adminOpen = true;
              if (session.user?.is_admin === true) {
                void (async () => {
                  await refreshAdminAccess();
                  await refreshUserApiKeys();
                })();
                adminRosterRefreshTimer = window.setInterval(() => {
                  if (
                    adminOpen &&
                    authSession?.user?.is_admin === true &&
                    !adminLoading &&
                    !adminEntrySaving &&
                    !whitelistSaving &&
                    !pendingAppGrants.size &&
                    !pendingAlphaActions.size
                  ) {
                    void refreshAdminAccess();
                  }
                }, 60_000);
              } else {
                void refreshUserApiKeys();
              }
            } else {
              void goto('/');
            }
          }
          if (session) {
            const updatePresence = () => {
              void sendPresenceHeartbeat().catch((cause) => {
                console.error('Could not send website presence heartbeat', cause);
              });
            };
            updatePresence();
            presenceHeartbeatTimer = window.setInterval(updatePresence, 20_000);
            authRefreshTimer = window.setInterval(() => {
              void restoreAuth()
                .then((updatedSession) => {
                  authSession = updatedSession;
                  if (!updatedSession && authRefreshTimer !== undefined) {
                    window.clearInterval(authRefreshTimer);
                    authRefreshTimer = undefined;
                    if (presenceHeartbeatTimer !== undefined) {
                      window.clearInterval(presenceHeartbeatTimer);
                      presenceHeartbeatTimer = undefined;
                    }
                    if (adminRosterRefreshTimer !== undefined) {
                      window.clearInterval(adminRosterRefreshTimer);
                      adminRosterRefreshTimer = undefined;
                    }
                    if (data.isDashboard || data.isAccount) void goto('/');
                  }
                })
                .catch((cause) => {
                  console.error('Could not refresh website auth session', cause);
                });
            }, 15 * 60 * 1000);
          }
        })
        .catch((cause) => {
          authSession = null;
          if (data.isDashboard) {
            dashboardAuthError = cause instanceof Error
              ? cause.message
              : 'Could not verify your session.';
          }
          if (data.isAccount) {
            accountAuthError = cause instanceof Error
              ? cause.message
              : 'Could not verify your session.';
          }
        })
        .finally(() => {
          authLoading = false;
        });

      await authTask;

      if (!data.isDashboard && !data.isAccount && !isLisnnto && !isNote) {
        unsubscribeProjects = subscribeToProjectUpdates(() => {
          void refreshProjects();
        });
      }
    })();

    return () => {
      unsubscribeProjects();
      unsubscribeHeartbeat();
      if (authRefreshTimer !== undefined) window.clearInterval(authRefreshTimer);
      if (presenceHeartbeatTimer !== undefined) window.clearInterval(presenceHeartbeatTimer);
      if (adminRosterRefreshTimer !== undefined) window.clearInterval(adminRosterRefreshTimer);
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
      projectAccess = null;
      projectAccessError = '';
      if (authRefreshTimer !== undefined) window.clearInterval(authRefreshTimer);
      if (presenceHeartbeatTimer !== undefined) window.clearInterval(presenceHeartbeatTimer);
      presenceHeartbeatTimer = undefined;
      if (adminRosterRefreshTimer !== undefined) window.clearInterval(adminRosterRefreshTimer);
      adminRosterRefreshTimer = undefined;
      if (data.isAccount) void goto('/');
    }
  };

  const toggleProfileMenu = (event: MouseEvent) => {
    event.stopPropagation();
    if (authSession?.user?.is_admin !== true) adminAccess = null;
    profileMenuOpen = !profileMenuOpen && Boolean(authSession);
  };

  const openAccount = async () => {
    profileMenuOpen = false;
    adminOpen = false;
    await goto('/account');
  };

  const loadAccountDetails = async () => {
    if (!authSession || projectAccessLoading || alphaAccessLoading) return;
    await loadProjectAccess();
    await loadAlphaAccess();
    if (projectAccessError || !hasLisnntoAccess() || limits || limitsLoading) return;
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

  const hasLisnntoAccess = () =>
    projectAccess?.projects.some(
      (project) => project.slug.toLowerCase() === 'lisnnto' && project.allowed
    ) === true;

  const loadProjectAccess = async () => {
    projectAccessLoading = true;
    projectAccessError = '';
    try {
      projectAccess = await getProjectAccess();
    } catch (cause) {
      projectAccessError = cause instanceof Error ? cause.message : 'Could not load project access.';
    } finally {
      projectAccessLoading = false;
    }
  };

  const loadAlphaAccess = async () => {
    alphaAccessLoading = true;
    alphaAccessError = '';
    try {
      alphaAccess = await getAlphaAccessStatus();
    } catch (cause) {
      alphaAccessError = cause instanceof Error ? cause.message : 'Could not load Alpha access.';
    } finally {
      alphaAccessLoading = false;
    }
  };

  const refreshAdminAccess = async (page = adminUserPage) => {
    if (adminLoading) return;
    adminLoading = true;
    adminError = '';
    try {
      adminAccess = await getAdminAccess(adminUserSearch, page);
      adminUserPage = adminAccess.page;
    } catch (cause) {
      adminError = cause instanceof Error ? cause.message : 'Could not load access settings.';
    } finally {
      adminLoading = false;
    }
  };

  const refreshUserApiKeys = async () => {
    if (apiKeysLoading) return;
    apiKeysLoading = true;
    apiKeysError = '';
    try {
      const keys = await getUserApiKeys();
      const pendingKeys = userApiKeys.filter((key) => key.id.startsWith('pending:'));
      userApiKeys = [...keys, ...pendingKeys];
    } catch (cause) {
      apiKeysError = cause instanceof Error ? cause.message : 'Could not load API keys.';
    } finally {
      apiKeysLoading = false;
    }
  };

  const createApiKey = async (event: SubmitEvent) => {
    event.preventDefault();
    const name = apiKeyName.trim();
    if (!name || apiKeyCreating) return;
    apiKeysError = '';
    apiKeysMessage = '';
    createdApiKey = '';
    apiKeyCreating = true;
    const pendingId = `pending:${++pendingApiKeySequence}`;
    userApiKeys = [{
      id: pendingId,
      name,
      key_prefix: 'Creating',
      created_at: new Date().toISOString(),
      last_used_at: null
    }, ...userApiKeys];
    apiKeyName = '';
    apiKeysMessage = 'Creating API key…';
    try {
      const result = await createUserApiKey(name);
      userApiKeys = userApiKeys.map((key) => key.id === pendingId ? result.key : key);
      createdApiKey = result.api_key;
      apiKeysMessage = 'Copy this key now. It will not be shown again.';
    } catch (cause) {
      userApiKeys = userApiKeys.filter((key) => key.id !== pendingId);
      if (!apiKeyName) apiKeyName = name;
      apiKeysError = cause instanceof Error ? cause.message : 'Could not create API key.';
    } finally {
      apiKeyCreating = false;
    }
  };

  const revokeApiKey = async (key: UserApiKey) => {
    if (!window.confirm(`Revoke “${key.name}”? Applications using this key will lose access immediately.`)) return;
    apiKeysError = '';
    apiKeysMessage = `Revoking “${key.name}”…`;
    const originalIndex = userApiKeys.findIndex((item) => item.id === key.id);
    const previousCreatedApiKey = createdApiKey;
    userApiKeys = userApiKeys.filter((item) => item.id !== key.id);
    if (createdApiKey.startsWith(key.key_prefix)) createdApiKey = '';
    try {
      await revokeUserApiKey(key.id);
      apiKeysMessage = `“${key.name}” was revoked.`;
    } catch (cause) {
      if (!userApiKeys.some((item) => item.id === key.id)) {
        const restoredKeys = [...userApiKeys];
        restoredKeys.splice(Math.min(originalIndex, restoredKeys.length), 0, key);
        userApiKeys = restoredKeys;
      }
      if (!createdApiKey) createdApiKey = previousCreatedApiKey;
      apiKeysError = cause instanceof Error ? cause.message : 'Could not revoke API key.';
    }
  };

  const openAdmin = () => {
    profileMenuOpen = false;
    accountOpen = false;
    if (!authSession) return;
    void goto('/dashboard');
  };

  const closeAdmin = () => {
    adminOpen = false;
    void goto('/');
  };

  const saveWhitelistSetting = async (enabled: boolean) => {
    if (whitelistSaving || !adminAccess) return;
    whitelistSaving = true;
    adminError = '';
    adminMessage = '';
    const previousValue = adminAccess.whitelist_enabled;
    adminAccess = { ...adminAccess, whitelist_enabled: enabled };
    adminMessage = 'Saving whitelist setting…';
    try {
      await updateWhitelistSetting(enabled);
      adminMessage = 'Whitelist setting saved.';
    } catch (cause) {
      if (adminAccess) adminAccess = { ...adminAccess, whitelist_enabled: previousValue };
      adminError = cause instanceof Error ? cause.message : 'Could not update whitelist setting.';
    } finally {
      whitelistSaving = false;
    }
  };

  const addAccessEntry = async (event: SubmitEvent) => {
    event.preventDefault();
    if (adminEntrySaving) return;
    const email = adminEmail.trim();
    const reason = adminReason.trim();
    if (!email || !adminAccess) return;
    adminError = '';
    adminMessage = '';
    const previousAccess = adminAccess;
    if (adminAction === 'whitelist' || adminAction === 'blacklist') {
      const target = adminAction;
      const opposite = target === 'whitelist' ? 'blacklist' : 'whitelist';
      const entry = { email, reason: reason || null, updated_at: new Date().toISOString() };
      adminAccess = {
        ...adminAccess,
        [opposite]: adminAccess[opposite].filter((item) => item.email.toLowerCase() !== email.toLowerCase()),
        [target]: [entry, ...adminAccess[target].filter((item) => item.email.toLowerCase() !== email.toLowerCase())]
      };
    } else {
      const matchingUser = adminAccess.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
      const pendingAdmin = {
        user_id: matchingUser?.user_id ?? `pending:${email.toLowerCase()}`,
        email,
        name: matchingUser?.name ?? null
      };
      adminAccess = {
        ...adminAccess,
        admins: [pendingAdmin, ...adminAccess.admins.filter((admin) => admin.email?.toLowerCase() !== email.toLowerCase())],
        users: matchingUser
          ? adminAccess.users.map((user) => user.user_id === matchingUser.user_id ? { ...user, is_admin: true } : user)
          : adminAccess.users
      };
    }
    adminEmail = '';
    adminReason = '';
    adminMessage = 'Saving access…';
    adminEntrySaving = true;
    try {
      await addAdminAccessEntry(adminAction, email, reason);
      adminMessage = adminAction === 'admin' ? 'Administrator permission granted.' : 'Access list updated.';
      void refreshAdminAccess();
    } catch (cause) {
      adminAccess = previousAccess;
      if (!adminEmail) adminEmail = email;
      if (!adminReason) adminReason = reason;
      adminError = cause instanceof Error ? cause.message : 'Could not update user access.';
    } finally {
      adminEntrySaving = false;
    }
  };

  const searchAdminUsers = (event: SubmitEvent) => {
    event.preventDefault();
    void refreshAdminAccess(1);
  };

  const toggleAdminUserProjects = (userId: string) => {
    const expanded = new Set(expandedAdminUsers);
    if (expanded.has(userId)) expanded.delete(userId);
    else expanded.add(userId);
    expandedAdminUsers = expanded;
  };

  const formatAdminDeviceDate = (value: string | null) => {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  };

  const loadAdminUserDevices = async (userId: string, force = false) => {
    const current = adminDevicePanels[userId];
    if (!force && (current?.loading || (current && current.devices !== null && !current.error))) return;
    adminDevicePanels = {
      ...adminDevicePanels,
      [userId]: { loading: true, error: '', devices: current?.devices ?? null }
    };
    try {
      const devices = await getAdminUserDevices(userId);
      adminDevicePanels = {
        ...adminDevicePanels,
        [userId]: { loading: false, error: '', devices }
      };
    } catch (cause) {
      adminDevicePanels = {
        ...adminDevicePanels,
        [userId]: {
          loading: false,
          error: cause instanceof Error ? cause.message : 'Could not load device details.',
          devices: current?.devices ?? null
        }
      };
    }
  };

  const toggleAdminUserDevices = (userId: string) => {
    const expanded = new Set(expandedDeviceUsers);
    if (expanded.has(userId)) expanded.delete(userId);
    else {
      expanded.add(userId);
      void loadAdminUserDevices(userId);
    }
    expandedDeviceUsers = expanded;
  };

  const updateAdminDevice = async (
    userId: string,
    device: AdminDevice,
    action: 'sign_out' | 'remove_trust'
  ) => {
    const key = `${userId}:${device.device_id}`;
    if (pendingDeviceActions.has(key)) return;
    pendingDeviceActions = new Set([...pendingDeviceActions, key]);
    deviceActionErrors = { ...deviceActionErrors, [key]: '' };
    deviceActionMessages = { ...deviceActionMessages, [key]: '' };
    try {
      if (action === 'sign_out') {
        await signOutAdminDevice(userId, device.device_id);
        deviceActionMessages = {
          ...deviceActionMessages,
          [key]: 'Refresh session revoked. Existing access tokens remain valid until expiry.'
        };
      } else {
        await removeAdminDeviceTrust(userId, device.device_id);
        deviceActionMessages = {
          ...deviceActionMessages,
          [key]: 'Trust removed. This does not sign out the device.'
        };
      }
      await Promise.all([
        loadAdminUserDevices(userId, true),
        refreshAdminAccess()
      ]);
    } catch (cause) {
      deviceActionErrors = {
        ...deviceActionErrors,
        [key]: cause instanceof Error ? cause.message : 'Could not update this device.'
      };
    } finally {
      const pending = new Set(pendingDeviceActions);
      pending.delete(key);
      pendingDeviceActions = pending;
    }
  };

  const toggleAdminAppGrant = async (
    userId: string,
    appSlug: string,
    shouldGrant: boolean
  ) => {
    const key = `${userId}:${appSlug}`;
    if (pendingAppGrants.has(key)) return;
    pendingAppGrants = new Set([...pendingAppGrants, key]);
    appGrantErrors = { ...appGrantErrors, [key]: '' };
    appGrantMessages = { ...appGrantMessages, [key]: '' };
    const previousAccess = adminAccess;
    if (adminAccess) {
      adminAccess = {
        ...adminAccess,
        users: adminAccess.users.map((user) => {
          if (user.user_id !== userId) return user;
          const app_slugs = new Set(user.app_slugs);
          if (shouldGrant) app_slugs.add(appSlug);
          else app_slugs.delete(appSlug);
          return { ...user, app_slugs: [...app_slugs] };
        })
      };
    }
    try {
      if (shouldGrant) await grantAdminAppAccess(userId, appSlug);
      else await revokeAdminAppAccess(userId, appSlug);
      appGrantMessages = { ...appGrantMessages, [key]: 'Saved.' };
    } catch (cause) {
      if (adminAccess && previousAccess) {
        const previousUser = previousAccess.users.find((user) => user.user_id === userId);
        adminAccess = {
          ...adminAccess,
          users: adminAccess.users.map((user) => {
            if (user.user_id !== userId || !previousUser) return user;
            const app_slugs = new Set(user.app_slugs);
            if (previousUser.app_slugs.includes(appSlug)) app_slugs.add(appSlug);
            else app_slugs.delete(appSlug);
            return { ...user, app_slugs: [...app_slugs] };
          })
        };
      }
      appGrantErrors = {
        ...appGrantErrors,
        [key]: cause instanceof Error ? cause.message : 'Could not update project access.'
      };
    } finally {
      const pending = new Set(pendingAppGrants);
      pending.delete(key);
      pendingAppGrants = pending;
    }
  };

  const toggleAdminAllProjectsAccess = async (
    userId: string,
    shouldGrant: boolean
  ) => {
    const key = `all:${userId}`;
    if (pendingAlphaActions.has(key) || !adminAccess) return;
    const previousAccess = adminAccess;
    pendingAlphaActions = new Set([...pendingAlphaActions, key]);
    alphaActionErrors = { ...alphaActionErrors, [key]: '' };
    alphaActionMessages = { ...alphaActionMessages, [key]: '' };
    adminAccess = {
      ...adminAccess,
      users: adminAccess.users.map((user) => user.user_id === userId
        ? {
            ...user,
            all_projects_access: shouldGrant,
            app_slugs: shouldGrant ? user.app_slugs : []
          }
        : user)
    };
    try {
      await setAdminAllProjectsAccess(userId, shouldGrant);
      alphaActionMessages = {
        ...alphaActionMessages,
        [key]: shouldGrant ? 'Access to all projects granted.' : 'Access to all projects revoked.'
      };
    } catch (cause) {
      adminAccess = previousAccess;
      alphaActionErrors = {
        ...alphaActionErrors,
        [key]: cause instanceof Error ? cause.message : 'Could not update all-project access.'
      };
    } finally {
      const pending = new Set(pendingAlphaActions);
      pending.delete(key);
      pendingAlphaActions = pending;
      void refreshAdminAccess();
    }
  };

  const handleAlphaRequest = async (
    userId: string,
    action: 'approve_alpha' | 'reject_alpha' | 'retry_alpha_notification'
  ) => {
    const key = `request:${userId}`;
    if (pendingAlphaActions.has(key)) return;
    pendingAlphaActions = new Set([...pendingAlphaActions, key]);
    alphaActionErrors = { ...alphaActionErrors, [key]: '' };
    alphaActionMessages = { ...alphaActionMessages, [key]: '' };
    try {
      await updateAdminAlphaRequest(userId, action);
      alphaActionMessages = {
        ...alphaActionMessages,
        [key]: action === 'reject_alpha'
          ? 'Alpha request rejected.'
          : action === 'retry_alpha_notification'
            ? 'Access email sent.'
            : 'Alpha access approved.'
      };
      adminError = '';
      adminMessage = action === 'reject_alpha'
        ? 'Alpha access request rejected.'
        : action === 'retry_alpha_notification'
          ? 'Alpha access email sent.'
          : 'Alpha access approved and all projects granted.';
    } catch (cause) {
      alphaActionErrors = {
        ...alphaActionErrors,
        [key]: cause instanceof Error ? cause.message : 'Could not update Alpha access.'
      };
    } finally {
      const pending = new Set(pendingAlphaActions);
      pending.delete(key);
      pendingAlphaActions = pending;
      void refreshAdminAccess();
    }
  };

  const removeAccessEntry = async (action: 'whitelist' | 'blacklist' | 'admin', identifier: string) => {
    adminError = '';
    adminMessage = '';
    const previousAccess = adminAccess;
    if (adminAccess) {
      if (action === 'whitelist' || action === 'blacklist') {
        adminAccess = {
          ...adminAccess,
          [action]: adminAccess[action].filter((entry) => entry.email !== identifier)
        };
      } else {
        adminAccess = {
          ...adminAccess,
          admins: adminAccess.admins.filter((admin) => admin.user_id !== identifier),
          users: adminAccess.users.map((user) => user.user_id === identifier ? { ...user, is_admin: false } : user)
        };
      }
    }
    adminMessage = 'Removing access…';
    try {
      await removeAdminAccessEntry(action, identifier);
      adminMessage = action === 'admin' ? 'Administrator permission removed.' : 'User removed from the list.';
      if (action === 'admin' && identifier === authSession?.user?.id) {
        try {
          authSession = await restoreAuth();
        } catch (cause) {
          adminError = cause instanceof Error ? cause.message : 'Could not refresh your administrator session.';
          return;
        }
        if (authSession?.user?.is_admin !== true) {
          adminOpen = false;
          adminAccess = null;
          return;
        }
      }
      void refreshAdminAccess();
    } catch (cause) {
      adminAccess = previousAccess;
      adminError = cause instanceof Error ? cause.message : 'Could not remove user access.';
    }
  };

  const kickOnlineUser = async (userId: string, blacklist = false) => {
    const actionLabel = blacklist ? 'blacklist and sign out' : 'sign out';
    if (!window.confirm(`Are you sure you want to ${actionLabel} this user?`)) return;
    adminError = '';
    adminMessage = '';
    const previousAccess = adminAccess;
    const user = adminAccess?.users.find((entry) => entry.user_id === userId);
    const userEmail = user?.email;
    if (adminAccess && user) {
      adminAccess = {
        ...adminAccess,
        users: adminAccess.users.map((entry) =>
          entry.user_id === userId ? { ...entry, is_online: false, device_count: 0 } : entry
        ),
        ...(blacklist && userEmail
          ? {
              whitelist: adminAccess.whitelist.filter((entry) => entry.email.toLowerCase() !== userEmail.toLowerCase()),
              blacklist: [
                { email: userEmail, reason: null, updated_at: new Date().toISOString() },
                ...adminAccess.blacklist.filter((entry) => entry.email.toLowerCase() !== userEmail.toLowerCase())
              ]
            }
          : {})
      };
    }
    adminMessage = blacklist ? 'Blacklisting and signing out…' : 'Signing out…';
    try {
      await kickAdminUser(userId, blacklist);
      adminMessage = blacklist
        ? 'User added to the blacklist and signed out.'
        : 'User signed out from all devices.';
      void refreshAdminAccess();
    } catch (cause) {
      adminAccess = previousAccess;
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

  const heartbeatBeatCount = (): number => Math.max(1, Math.floor(heartbeatMonitorWidth / 120));
  const heartbeatCycleWidth = (): number => heartbeatMonitorWidth / heartbeatBeatCount();
  const heartbeatSweepWidth = (): number => heartbeatMonitorWidth;
  const heartbeatFirstBeat = (): number => heartbeatCycleWidth();
  const heartbeatSweepStart = (): number => heartbeatFirstBeat() - heartbeatSweepWidth() - 18;
  const heartbeatSweepDuration = (): string => (heartbeatMonitorWidth / 150).toFixed(2);
  const heartbeatAnimationDuration = (): string => (heartbeatCycleWidth() / 150).toFixed(2);
  const prefersReducedMotion = () => browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const heartbeatSignalPath = (monitorWidth: number): string => {
    const cycleWidth = heartbeatCycleWidth();
    const firstBeat = 0;
    let path = `M0 60 H${firstBeat + cycleWidth * 0.2375}`;
    for (let index = 0; index < heartbeatBeatCount(); index += 1) {
      const x = firstBeat + index * cycleWidth;
      const at = (fraction: number) => x + cycleWidth * fraction;
      path += `Q${at(0.25)} 60 ${at(0.275)} 54 H${at(0.3125)} L${at(0.35625)} 14 L${at(0.4)} 105 L${at(0.45)} 60 Q${at(0.4875)} 60 ${at(0.525)} 53 Q${at(0.5625)} 60 ${at(0.6125)} 60 H${Math.min(monitorWidth, at(1.2375))}`;
    }
    return `${path} H${monitorWidth}`;
  };

  const heartbeatBaselineGapPath = (monitorWidth: number): string => {
    const segments: string[] = [];
    const cycleWidth = heartbeatCycleWidth();
    const firstBeat = 0;
    for (let index = 0; index < heartbeatBeatCount(); index += 1) {
      const x = firstBeat + index * cycleWidth;
      const at = (fraction: number) => x + cycleWidth * fraction;
      segments.push(`M${at(0.2125)} 60 H${at(0.6125)}`);
    }
    return segments.join(' ');
  };

</script>

<svelte:head>
  <title>{data.isAccount ? 'Account — Thieez' : isLisnnto ? 'Lisnnto — Thieez' : isNote ? 'Note — Thieez' : 'Thieez — Things we’re building'}</title>
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
          <button class="auth-button" onclick={() => void goto('/alpha')}>Sign in</button>
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
        {#if isLisnnto || isNote}
          <a class="text-button" href={`/projects/${encodeURIComponent(projectSlug)}`}>Check access again <span aria-hidden="true">↗</span></a>
        {/if}
        <a class="text-button" href="https://thieez.com/">Back to Thieez <span aria-hidden="true">↗</span></a>
      </section>
    {:else if accessCheckFailed}
      <section class="account-view" aria-labelledby="access-check-heading">
        <p class="eyebrow">THIEEZ / {projectName.toUpperCase()}</p>
        <h1 id="access-check-heading">Access check <em>unavailable.</em></h1>
        <p class="lede">We couldn’t verify access right now. Please try again shortly.</p>
        <a class="text-button" href="https://thieez.com/">Back to Thieez <span aria-hidden="true">↗</span></a>
      </section>
    {:else if data.isDashboard && dashboardAuthError}
      <section class="account-view" aria-labelledby="dashboard-auth-error-heading">
        <p class="eyebrow">THIEEZ / DASHBOARD</p>
        <h1 id="dashboard-auth-error-heading">Session check <em>unavailable.</em></h1>
        <p class="lede">We couldn’t verify your session, so the dashboard couldn’t be loaded. Your account hasn’t been signed out.</p>
        <div class="state-panel error-panel admin-feedback" role="alert">
          <span>{dashboardAuthError}</span>
          <button class="text-button" onclick={() => window.location.reload()}>Try again</button>
        </div>
      </section>
    {:else if adminOpen}
      <section class="account-view admin-view" aria-labelledby="admin-heading">
        <div class="account-topline">
          <p class="eyebrow">THIEEZ / DASHBOARD</p>
          <button class="text-button" onclick={closeAdmin}>Close <span aria-hidden="true">×</span></button>
        </div>
        <h1 id="admin-heading">Your <em>dashboard.</em></h1>
        <p class="lede">Create and revoke API keys for your account. Keys inherit your account’s API access.</p>
        {#if apiKeysError}
          <div class="state-panel error-panel admin-feedback" role="alert">
            <strong>Couldn’t manage API keys.</strong><span>{apiKeysError}</span>
            <button class="text-button" onclick={refreshUserApiKeys}>Try again</button>
          </div>
        {:else if apiKeysMessage}
          <div class="state-panel admin-feedback" role="status">{apiKeysMessage}</div>
        {/if}
        {#if createdApiKey}
          <div class="api-key-created" role="status">
            <strong>New API key — copy it now</strong>
            <input aria-label="New API key" readonly value={createdApiKey} onclick={(event) => event.currentTarget.select()} />
            <small>This secret is only shown once. Store it securely and send it as a Bearer token.</small>
          </div>
        {/if}
        <form class="admin-entry-form api-key-form" onsubmit={createApiKey}>
          <label>
            <span>Key name</span>
            <input type="text" bind:value={apiKeyName} required maxlength="60" autocomplete="off" placeholder="My integration" />
          </label>
          <button class="admin-submit" type="submit" disabled={apiKeysLoading || apiKeyCreating || !apiKeyName.trim()}>
            {apiKeyCreating ? 'Creating…' : apiKeysLoading ? 'Working…' : 'Create API key'} <span aria-hidden="true">↗</span>
          </button>
        </form>
        <section class="user-api-keys">
          <div class="section-heading">
            <h2>Your API keys</h2>
            <button class="text-button" onclick={refreshUserApiKeys}>Refresh</button>
          </div>
          {#if apiKeysLoading && !userApiKeys.length}
            <div class="state-panel" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Loading API keys…</span></div>
          {:else if userApiKeys.length}
            {#each userApiKeys as key (key.id)}
              <div class="admin-list-row">
                <span>
                  <strong>{key.name}</strong>
                  <small>{key.key_prefix}… · Created {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(key.created_at))}{key.last_used_at ? ` · Last used ${new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(key.last_used_at))}` : ' · Never used'}</small>
                </span>
                <button class="text-button admin-block-button" disabled={key.id.startsWith('pending:')} onclick={() => void revokeApiKey(key)}>
                  {key.id.startsWith('pending:') ? 'Creating…' : 'Revoke'}
                </button>
              </div>
            {/each}
          {:else}
            <p class="admin-empty">You haven’t created any API keys yet.</p>
          {/if}
        </section>
        {#if authSession?.user?.is_admin === true}
        {#if adminError}
          <div class="state-panel error-panel admin-feedback" role="alert">
            <strong>Couldn’t update access settings.</strong><span>{adminError}</span>
            <button class="text-button" onclick={() => void refreshAdminAccess()}>Try again</button>
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
              disabled={whitelistSaving}
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
            <button class="admin-submit" type="submit" disabled={adminEntrySaving}>
              {adminEntrySaving ? 'Saving…' : 'Save permission'} <span aria-hidden="true">↗</span>
            </button>
          </form>
          <section class="admin-alpha-requests" aria-labelledby="alpha-requests-heading">
            <div class="section-heading">
              <h2 id="alpha-requests-heading">Alpha access requests</h2>
              <span>{adminAccess.alpha_requests.length} needs attention</span>
            </div>
            {#if adminAccess.alpha_requests.length}
              <div class="admin-alpha-request-list">
                {#each adminAccess.alpha_requests as alphaRequest (alphaRequest.user_id)}
                  {@const actionKey = `request:${alphaRequest.user_id}`}
                  <article class="admin-alpha-request">
                    <div>
                      <strong>{alphaRequest.name || alphaRequest.email || alphaRequest.user_id}</strong>
                      {#if alphaRequest.name && alphaRequest.email}<small>{alphaRequest.email}</small>{/if}
                      <small>
                        {alphaRequest.status === 'pending'
                          ? `Requested ${alphaRequest.requested_at ? new Date(alphaRequest.requested_at).toLocaleDateString() : 'recently'}`
                          : 'Access granted; notification email not sent'}
                      </small>
                    </div>
                    <div class="admin-alpha-actions">
                      {#if alphaRequest.status === 'pending'}
                        <button
                          class="admin-submit"
                          disabled={pendingAlphaActions.has(actionKey)}
                          onclick={() => void handleAlphaRequest(alphaRequest.user_id, 'approve_alpha')}
                        >Approve</button>
                        <button
                          class="text-button admin-block-button"
                          disabled={pendingAlphaActions.has(actionKey)}
                          onclick={() => void handleAlphaRequest(alphaRequest.user_id, 'reject_alpha')}
                        >Reject</button>
                      {:else}
                        <button
                          class="admin-submit"
                          disabled={pendingAlphaActions.has(actionKey)}
                          onclick={() => void handleAlphaRequest(alphaRequest.user_id, 'retry_alpha_notification')}
                        >Retry email</button>
                      {/if}
                    </div>
                    {#if alphaActionErrors[actionKey]}
                      <small class="grant-error" role="alert">{alphaActionErrors[actionKey]}</small>
                    {:else if alphaActionMessages[actionKey]}
                      <small class="grant-feedback" role="status">{alphaActionMessages[actionKey]}</small>
                    {/if}
                  </article>
                {/each}
              </div>
            {:else}
              <p class="admin-empty">There are no pending Alpha requests or undelivered approval emails.</p>
            {/if}
          </section>
          <section class="admin-app-access" aria-labelledby="app-access-heading">
            <div class="section-heading">
              <h2 id="app-access-heading">Project access</h2>
              <span>{adminAccess.apps.length} published projects</span>
            </div>
            <p class="admin-empty">Every project grant is explicit, including access for administrators.</p>
            <form class="admin-roster-search" onsubmit={searchAdminUsers}>
              <label for="admin-user-search">Find a registered user</label>
              <input
                id="admin-user-search"
                type="search"
                bind:value={adminUserSearch}
                maxlength="200"
                placeholder="Search by email or name"
                autocomplete="off"
              />
              <button class="admin-submit" type="submit" disabled={adminLoading}>
                Search <span aria-hidden="true">↗</span>
              </button>
            </form>
            <div class="section-heading roster-heading">
              <span>{adminUserSearch.trim() ? `Matches for “${adminUserSearch.trim()}”` : 'Registered users'}</span>
              <span>{adminAccess.users.length} shown · page {adminAccess.page}</span>
              <button class="text-button" onclick={() => void refreshAdminAccess()}>Refresh</button>
            </div>
            {#if adminLoading && !adminAccess.users.length}
              <div class="state-panel" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Loading registered users…</span></div>
            {:else if adminAccess.users.length}
              <div class="admin-roster">
                {#each adminAccess.users as rosterUser (rosterUser.user_id)}
                  <article class="admin-roster-user">
                    <div class="admin-roster-row">
                      <div class="admin-roster-identity">
                        <strong>{rosterUser.name || rosterUser.email || rosterUser.user_id}</strong>
                        {#if rosterUser.name && rosterUser.email}<small>{rosterUser.email}</small>{/if}
                        <small>
                          <span class:roster-online={rosterUser.is_online} class="roster-presence">
                            <i aria-hidden="true"></i>{rosterUser.is_online ? 'Online' : 'Offline'}
                          </span>
                          {#if rosterUser.is_admin}<span class="roster-admin-label">Administrator</span>{/if}
                        </small>
                      </div>
                      <button
                        class="text-button roster-device-toggle"
                        aria-expanded={expandedDeviceUsers.has(rosterUser.user_id)}
                        aria-controls={`devices-${rosterUser.user_id}`}
                        onclick={() => toggleAdminUserDevices(rosterUser.user_id)}
                      >
                        {rosterUser.device_count}
                        {rosterUser.device_count === 1 ? 'session' : 'sessions'}
                        <span aria-hidden="true">{expandedDeviceUsers.has(rosterUser.user_id) ? '−' : '+'}</span>
                      </button>
                      <div class="admin-roster-actions">
                        <button
                          class="text-button roster-project-toggle"
                          aria-expanded={expandedAdminUsers.has(rosterUser.user_id)}
                          aria-controls={`projects-${rosterUser.user_id}`}
                          onclick={() => toggleAdminUserProjects(rosterUser.user_id)}
                        >
                          {expandedAdminUsers.has(rosterUser.user_id) ? 'Hide projects' : 'Projects'}
                          <span>{rosterUser.all_projects_access ? 'All projects' : `${rosterUser.app_slugs.length}/${adminAccess.apps.length}`}</span>
                        </button>
                        {#if rosterUser.user_id !== authSession?.user?.id}
                          <button class="text-button" onclick={() => void kickOnlineUser(rosterUser.user_id)}>Sign out</button>
                          <button class="text-button admin-block-button" onclick={() => void kickOnlineUser(rosterUser.user_id, true)}>Blacklist + sign out</button>
                        {:else}
                          <span class="admin-self-label">You</span>
                        {/if}
                      </div>
                    </div>
                    {#if expandedAdminUsers.has(rosterUser.user_id)}
                      {@const allProjectsKey = `all:${rosterUser.user_id}`}
                      <div class="admin-project-checklist" id={`projects-${rosterUser.user_id}`}>
                        <label class="admin-project-option admin-all-project-option">
                          <input
                            type="checkbox"
                            checked={rosterUser.all_projects_access}
                            disabled={pendingAlphaActions.has(allProjectsKey)}
                            aria-label={`All project access for ${rosterUser.email || rosterUser.name || rosterUser.user_id}`}
                            onchange={(event) => void toggleAdminAllProjectsAccess(
                              rosterUser.user_id,
                              event.currentTarget.checked
                            )}
                          />
                          <span>All projects access<small>Grant or revoke access to every published project</small></span>
                          {#if alphaActionErrors[allProjectsKey]}
                            <small class="grant-error" role="alert">{alphaActionErrors[allProjectsKey]}</small>
                          {:else if alphaActionMessages[allProjectsKey]}
                            <small class="grant-feedback" role="status">{alphaActionMessages[allProjectsKey]}</small>
                          {/if}
                        </label>
                        {#if adminAccess.apps.length}
                          {#each adminAccess.apps as app (app.slug)}
                            {@const grantKey = `${rosterUser.user_id}:${app.slug}`}
                            <label class="admin-project-option">
                              <input
                                type="checkbox"
                                checked={rosterUser.all_projects_access || rosterUser.app_slugs.includes(app.slug)}
                                disabled={rosterUser.all_projects_access || pendingAppGrants.has(grantKey)}
                                aria-label={`${app.name} access for ${rosterUser.email || rosterUser.name || rosterUser.user_id}`}
                                aria-describedby={appGrantErrors[grantKey] ? `grant-error-${grantKey}` : undefined}
                                onchange={(event) => void toggleAdminAppGrant(
                                  rosterUser.user_id,
                                  app.slug,
                                  event.currentTarget.checked
                                )}
                              />
                              <span>{app.name}<small>{app.repository}</small></span>
                              {#if pendingAppGrants.has(grantKey)}
                                <small class="grant-feedback" aria-live="polite">Saving…</small>
                              {:else if appGrantErrors[grantKey]}
                                <small class="grant-error" id={`grant-error-${grantKey}`} role="alert">{appGrantErrors[grantKey]}</small>
                              {:else if appGrantMessages[grantKey]}
                                <small class="grant-feedback" aria-live="polite">{appGrantMessages[grantKey]}</small>
                              {/if}
                            </label>
                          {/each}
                        {:else}
                          <p class="admin-empty">No published projects are available.</p>
                        {/if}
                      </div>
                    {/if}
                    {#if expandedDeviceUsers.has(rosterUser.user_id)}
                      {@const devicePanel = adminDevicePanels[rosterUser.user_id]}
                      <section
                        class="admin-device-panel"
                        id={`devices-${rosterUser.user_id}`}
                        aria-label={`Trusted devices and sessions for ${rosterUser.email || rosterUser.name || rosterUser.user_id}`}
                      >
                        <div class="admin-device-panel-heading">
                          <strong>Devices and sessions</strong>
                          <button
                            class="text-button"
                            disabled={devicePanel?.loading}
                            onclick={() => void loadAdminUserDevices(rosterUser.user_id, true)}
                          >Refresh</button>
                        </div>
                        {#if devicePanel?.loading && devicePanel.devices === null}
                          <p class="admin-empty device-loading" role="status">Loading device details…</p>
                        {:else if devicePanel?.error}
                          <div class="device-fetch-error" role="alert">
                            <span>{devicePanel.error}</span>
                            <button class="text-button" onclick={() => void loadAdminUserDevices(rosterUser.user_id, true)}>Try again</button>
                          </div>
                        {:else if devicePanel?.devices?.length}
                          {#if devicePanel.loading}<p class="device-refreshing" role="status">Refreshing devices…</p>{/if}
                          {#each devicePanel.devices as device (device.device_id)}
                            {@const actionKey = `${rosterUser.user_id}:${device.device_id}`}
                            <article class="admin-device-row">
                              <div class="admin-device-info">
                                <strong>{device.device_name || device.device_id}</strong>
                                <small>ID · {device.device_id}</small>
                                <small>Trusted · {formatAdminDeviceDate(device.trusted_at)}</small>
                                <small>Last used · {formatAdminDeviceDate(device.last_used_at)}</small>
                              </div>
                              <div class="admin-device-status">
                                <span class:device-status-trusted={device.is_trusted} class="device-status">
                                  {device.is_trusted ? 'Trusted' : 'Not trusted'}
                                </span>
                                <span class:device-status-active={device.has_active_session} class="device-status">
                                  {device.has_active_session ? 'Active refresh session' : 'No active refresh session'}
                                </span>
                              </div>
                              <div class="admin-device-actions">
                                {#if device.has_active_session}
                                  <button
                                    class="text-button"
                                    disabled={pendingDeviceActions.has(actionKey)}
                                    onclick={() => void updateAdminDevice(rosterUser.user_id, device, 'sign_out')}
                                  >{pendingDeviceActions.has(actionKey) ? 'Signing out…' : 'Sign out'}</button>
                                {/if}
                                {#if device.is_trusted}
                                  <button
                                    class="text-button"
                                    disabled={pendingDeviceActions.has(actionKey)}
                                    onclick={() => void updateAdminDevice(rosterUser.user_id, device, 'remove_trust')}
                                  >{pendingDeviceActions.has(actionKey) ? 'Updating…' : 'Remove trust'}</button>
                                {/if}
                              </div>
                              {#if deviceActionErrors[actionKey]}
                                <p class="device-action-error" role="alert">{deviceActionErrors[actionKey]}</p>
                              {:else if deviceActionMessages[actionKey]}
                                <p class="device-action-feedback" role="status">{deviceActionMessages[actionKey]}</p>
                              {/if}
                            </article>
                          {/each}
                        {:else if devicePanel?.devices}
                          <p class="admin-empty">No trusted devices or login sessions found.</p>
                        {/if}
                      </section>
                    {/if}
                  </article>
                {/each}
              </div>
            {:else}
              <p class="admin-empty">
                {adminUserSearch.trim() ? 'No registered users match this search.' : 'No registered users found.'}
              </p>
            {/if}
            <nav class="admin-roster-pagination" aria-label="User roster pages">
              <button class="text-button" disabled={adminLoading || adminAccess.page <= 1} onclick={() => void refreshAdminAccess(adminAccess!.page - 1)}>← Previous</button>
              <span>Page {adminAccess.page}</span>
              <button class="text-button" disabled={adminLoading || !adminAccess.has_more} onclick={() => void refreshAdminAccess(adminAccess!.page + 1)}>Next →</button>
            </nav>
          </section>
          <div class="admin-lists">
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
        {/if}
      </section>
    {:else if accountOpen}
      <section class="account-view" aria-labelledby="account-heading">
        <div class="account-topline">
          <p class="eyebrow">THIEEZ / ACCOUNT</p>
          <a class="text-button" href="/">Back to Thieez <span aria-hidden="true">↗</span></a>
        </div>
        <h1 id="account-heading">Your <em>account.</em></h1>
        {#if authLoading}
          <div class="state-panel account-state" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Checking your account…</span></div>
        {:else if accountAuthError}
          <div class="state-panel error-panel account-state" role="alert">
            <strong>Couldn’t verify your account.</strong>
            <span>{accountAuthError}</span>
            <button class="text-button" onclick={() => window.location.reload()}>Try again</button>
          </div>
        {:else if !authSession}
          <p class="lede">Sign in to view your Alpha status and project access.</p>
          <button class="alpha-button account-sign-in" onclick={startLogin}>
            Sign in with Google <span aria-hidden="true">↗</span>
          </button>
        {:else}
          <div class="account-identity">
            {#if avatarUrl}
              <img src={avatarUrl} alt="" class="profile-avatar" />
            {:else}
              <span class="profile-avatar profile-avatar-fallback" aria-hidden="true">{userInitial}</span>
            {/if}
            <span><strong>{userLabel}</strong><small>{authSession.user?.email || 'Thieez account'}</small></span>
          </div>

          <section class="account-alpha-status" aria-labelledby="alpha-status-heading">
            <div class="section-heading">
              <h2 id="alpha-status-heading">Alpha access</h2>
            </div>
            {#if alphaAccessLoading}
              <div class="state-panel" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Checking Alpha status…</span></div>
            {:else if alphaAccessError}
              <div class="state-panel error-panel" role="alert">
                <strong>Couldn’t load Alpha status.</strong>
                <span>{alphaAccessError}</span>
                <button class="text-button" onclick={loadAlphaAccess}>Try again</button>
              </div>
            {:else if alphaAccess}
              <div class="account-alpha-card">
                <span
                  class="account-status-badge"
                  class:account-status-active={alphaAccess.has_access}
                  class:account-status-pending={alphaAccess.status === 'pending'}
                >
                  {alphaAccess.has_access
                    ? 'Alpha user'
                    : alphaAccess.status === 'pending'
                      ? 'Waiting for Alpha access'
                      : alphaAccess.status === 'approved'
                        ? 'Approved · access inactive'
                        : 'Not an Alpha user'}
                </span>
                <p>
                  {alphaAccess.has_access
                    ? 'Your account has Alpha access.'
                    : alphaAccess.status === 'pending'
                      ? 'Your request is awaiting administrator approval.'
                      : alphaAccess.status === 'approved'
                        ? 'Your request was approved, but Alpha access is currently inactive.'
                        : alphaAccess.status === 'rejected'
                          ? 'Your previous request was declined.'
                          : alphaAccess.status === 'revoked'
                            ? 'Your previous Alpha access was revoked.'
                            : 'You have not requested Alpha access yet.'}
                </p>
                {#if !alphaAccess.has_access && alphaAccess.status !== 'pending' && alphaAccess.status !== 'approved'}
                  <a class="text-button" href="/alpha">Request Alpha access <span aria-hidden="true">↗</span></a>
                {/if}
              </div>
            {/if}
          </section>

          <section class="account-project-access" aria-labelledby="project-access-heading">
            <div class="section-heading">
              <h2 id="project-access-heading">Project access</h2>
              {#if projectAccess}
                <span>{projectAccess.projects.filter((project) => project.allowed).length} of {projectAccess.projects.length} available</span>
              {/if}
            </div>
            {#if projectAccessLoading}
              <div class="state-panel" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Loading project access…</span></div>
            {:else if projectAccessError}
              <div class="state-panel error-panel" role="alert">
                <strong>Couldn’t load project access.</strong>
                <span>{projectAccessError}</span>
                <button class="text-button" onclick={loadAccountDetails}>Try again</button>
              </div>
            {:else if projectAccess}
              {#if projectAccess.projects.length}
                <div class="account-project-list">
                  {#each projectAccess.projects as project (project.slug)}
                    <article class="account-project-row">
                      <div class="account-project-info">
                        <span class="account-project-slug">{project.slug}</span>
                        <strong>{project.name}</strong>
                      </div>
                      <div class="account-project-action">
                        <span
                          class="account-project-status"
                          class:project-access-allowed={project.allowed}
                          class:project-access-denied={!project.allowed}
                        >{project.allowed ? 'Access granted' : 'No access'}</span>
                        {#if project.allowed && project.href}
                          <a class="text-button" href={project.href}>Open project <span aria-hidden="true">↗</span></a>
                        {/if}
                      </div>
                    </article>
                  {/each}
                </div>
              {:else}
                <div class="state-panel">There are no published projects yet.</div>
              {/if}
            {/if}
          </section>
          {#if projectAccess && !projectAccessLoading && !projectAccessError && hasLisnntoAccess()}
            {#if limitsLoading}
              <div class="state-panel" aria-live="polite"><span class="loader" aria-hidden="true"></span><span>Loading Lisnnto limits…</span></div>
            {:else if limitsError}
              <div class="state-panel error-panel" role="alert">
                <strong>Couldn’t load your limits.</strong>
                <span>{limitsError}</span>
                <button class="text-button" onclick={loadAccountDetails}>Try again</button>
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
          {/if}
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
              <path
                class="heartbeat-trace-up heartbeat-trace-dim"
                class:heartbeat-trace-hidden={heartbeatConnection !== 'connected'}
                d={`M0 60 H${heartbeatMonitorWidth}`}
                aria-hidden="true"
              />
              {#if !prefersReducedMotion()}
                <defs>
                  <linearGradient id="heartbeat-sweep-gradient">
                    <stop offset="0%" stop-color="white" stop-opacity="0" />
                    <stop offset="4%" stop-color="white" stop-opacity="0" />
                    <stop offset="8%" stop-color="white" />
                    <stop offset="92%" stop-color="white" />
                    <stop offset="96%" stop-color="white" stop-opacity="0" />
                    <stop offset="100%" stop-color="white" stop-opacity="0" />
                  </linearGradient>
                  <mask id="heartbeat-sweep-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={heartbeatMonitorWidth} height="120">
                    <rect width={heartbeatMonitorWidth} height="120" fill="black" />
                    <rect y="0" width={heartbeatSweepWidth()} height="120" fill="url(#heartbeat-sweep-gradient)">
                      <animate
                        attributeName="x"
                        from={heartbeatSweepStart()}
                        to={heartbeatSweepStart() + heartbeatMonitorWidth}
                        dur={`${heartbeatSweepDuration()}s`}
                        repeatCount="indefinite"
                      />
                    </rect>
                    <rect y="0" width={heartbeatSweepWidth()} height="120" fill="url(#heartbeat-sweep-gradient)">
                      <animate
                        attributeName="x"
                        from={heartbeatSweepStart() - heartbeatMonitorWidth}
                        to={heartbeatSweepStart()}
                        dur={`${heartbeatSweepDuration()}s`}
                        repeatCount="indefinite"
                      />
                    </rect>
                  </mask>
                </defs>
                <path
                  class="heartbeat-trace-cut"
                  class:heartbeat-trace-hidden={heartbeatConnection !== 'connected'}
                  d={heartbeatBaselineGapPath(heartbeatMonitorWidth)}
                  mask="url(#heartbeat-sweep-mask)"
                  aria-hidden="true"
                />
                <path
                  class="heartbeat-trace-up"
                  class:heartbeat-trace-hidden={heartbeatConnection !== 'connected'}
                  d={heartbeatSignalPath(heartbeatMonitorWidth)}
                  mask="url(#heartbeat-sweep-mask)"
                  aria-hidden="true"
                />
              {/if}
              {#if heartbeatConnection !== 'connected'}
                {#if heartbeatConnection === 'disconnected'}
                  <path class="heartbeat-trace-down heartbeat-trace-dim" d={`M0 60 H${heartbeatMonitorWidth}`} />
                {/if}
                <path
                  class:heartbeat-trace-down={heartbeatConnection === 'disconnected'}
                  class:heartbeat-trace-paused={heartbeatConnection === 'connecting'}
                  d={`M0 60 H${heartbeatMonitorWidth}`}
                  pathLength="1000"
                  stroke-dasharray={!prefersReducedMotion() ? '90 910' : undefined}
                >
                  {#if !prefersReducedMotion()}
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
          <div class="state-panel error-panel" role="alert"><strong>The index is taking a break.</strong><span>{projectError}</span><button class="text-button" onclick={refreshProjects}>Try again <span aria-hidden="true">↗</span></button></div>
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
