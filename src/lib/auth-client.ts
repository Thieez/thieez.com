import type { AuthUser } from '$lib/api';

const REQUEST_TIMEOUT_MS = 15_000;

export type AuthSession = {
  user: AuthUser | null;
};

export type AdminAccessEntry = {
  email: string;
  access_type?: 'whitelist' | 'blacklist';
  reason?: string | null;
  updated_at?: string;
};

export type AdminAccessData = {
  whitelist_enabled: boolean;
  whitelist: AdminAccessEntry[];
  blacklist: AdminAccessEntry[];
  apps: Array<{ slug: string; name: string; repository: string }>;
  alpha_requests: Array<{
    user_id: string;
    email: string | null;
    name: string | null;
    status: 'pending' | 'approved';
    requested_at: string | null;
    notification_sent: boolean;
  }>;
  users: Array<{
    user_id: string;
    email: string | null;
    name: string | null;
    is_online: boolean;
    last_active_at: string | null;
    device_count: number;
    is_admin: boolean;
    app_slugs: string[];
    all_projects_access: boolean;
  }>;
  page: number;
  page_size: number;
  has_more: boolean;
  admins: Array<{ user_id: string; email: string | null; name: string | null }>;
};

export type AlphaAccessStatus = {
  status: 'not_requested' | 'pending' | 'approved' | 'rejected' | 'revoked';
  requested_at: string | null;
  reviewed_at: string | null;
  has_access: boolean;
};

export type ProjectAccessStatus = {
  projects: Array<{
    slug: string;
    name: string;
    href: string;
    allowed: boolean;
  }>;
};

export type AdminDevice = {
  device_id: string;
  device_name: string | null;
  trusted_at: string | null;
  last_used_at: string | null;
  is_trusted: boolean;
  has_active_session: boolean;
};

export type UserApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
};

async function request(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Starts the Google OAuth flow through a same-origin, stateful login endpoint. */
export function startLogin(): void {
  if (typeof window === 'undefined') return;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/auth/login?return_to=${encodeURIComponent(returnTo)}`);
}

/** Loads the profile through the server, where the HttpOnly tokens are held. */
export async function restoreAuth(): Promise<AuthSession | null> {
  if (typeof window === 'undefined') return null;

  const response = await request('/auth/session', {
    headers: { Accept: 'application/json' }
  });
  const payload = (await response.json()) as {
    user?: AuthUser | null;
    is_admin?: boolean;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || `Could not restore session (${response.status})`);
  }
  return payload.user
    ? { user: { ...payload.user, is_admin: payload.is_admin === true } }
    : null;
}

export async function getAlphaAccessStatus(): Promise<AlphaAccessStatus> {
  const response = await request('/auth/alpha-access-request', {
    headers: { Accept: 'application/json' }
  });
  const payload = (await response.json()) as AlphaAccessStatus & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || `Could not load Alpha access (${response.status})`);
  return payload;
}

export async function submitAlphaAccessRequest(): Promise<AlphaAccessStatus> {
  const response = await request('/auth/alpha-access-request', { method: 'POST' });
  const payload = (await response.json()) as AlphaAccessStatus & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || `Could not request Alpha access (${response.status})`);
  return payload;
}

export async function logout(): Promise<void> {
  const response = await request('/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error(`Could not log out (${response.status})`);
}

export async function sendPresenceHeartbeat(): Promise<void> {
  const response = await request('/auth/presence', { method: 'POST' });
  if (!response.ok) throw new Error(`Could not update presence (${response.status})`);
}

export async function getLisnntoLimits(): Promise<import('$lib/api').LisnntoLimits> {
  const response = await request('/auth/lisnnto-limits', {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`Could not load Lisnnto limits (${response.status})`);
  }
  return response.json() as Promise<import('$lib/api').LisnntoLimits>;
}

export async function getProjectAccess(): Promise<ProjectAccessStatus> {
  const response = await request('/auth/project-access', {
    headers: { Accept: 'application/json' }
  });
  const payload = (await response.json()) as ProjectAccessStatus & { detail?: string };
  if (!response.ok) {
    throw new Error(payload.detail || `Could not load project access (${response.status})`);
  }
  return payload;
}

async function requestAdmin<T>(
  method: string,
  body?: Record<string, unknown>,
  query?: URLSearchParams,
  resource: 'access' | 'devices' = 'access'
): Promise<T> {
  const params = new URLSearchParams(query);
  if (resource === 'devices') params.set('resource', resource);
  const queryString = params.toString();
  const response = await request(`/admin/access${queryString ? `?${queryString}` : ''}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = (await response.json()) as T & { detail?: string };
  if (!response.ok) {
    throw new Error(payload.detail || `Admin request failed (${response.status})`);
  }
  return payload;
}

export function getAdminAccess(search = '', page = 1): Promise<AdminAccessData> {
  const query = new URLSearchParams({ page: String(page), page_size: '50' });
  if (search.trim()) query.set('search', search.trim());
  return requestAdmin<AdminAccessData>('GET', undefined, query);
}

export async function getAdminUserDevices(userId: string): Promise<AdminDevice[]> {
  const result = await requestAdmin<{ user_id: string; devices: AdminDevice[] }>(
    'GET',
    undefined,
    new URLSearchParams({ user_id: userId }),
    'devices'
  );
  return result.devices;
}

export function signOutAdminDevice(userId: string, deviceId: string): Promise<{
  user_id: string;
  device_id: string;
  revoked_sessions: number;
}> {
  return requestAdmin(
    'POST',
    { action: 'sign_out', user_id: userId, device_id: deviceId },
    undefined,
    'devices'
  );
}

export function removeAdminDeviceTrust(
  userId: string,
  deviceId: string
): Promise<{ user_id: string; device_id: string; removed: boolean }> {
  return requestAdmin(
    'DELETE',
    undefined,
    new URLSearchParams({ user_id: userId, device_id: deviceId }),
    'devices'
  );
}

async function requestApiKeys<T>(
  method: string,
  body?: Record<string, unknown>,
  keyId?: string
): Promise<T> {
  const query = keyId ? `?key_id=${encodeURIComponent(keyId)}` : '';
  const response = await request(`/auth/api-keys${query}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = (await response.json()) as T & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || `API key request failed (${response.status})`);
  return payload;
}

export async function getUserApiKeys(): Promise<UserApiKey[]> {
  const result = await requestApiKeys<{ api_keys: UserApiKey[] }>('GET');
  return result.api_keys;
}

export function createUserApiKey(name: string): Promise<{ api_key: string; key: UserApiKey }> {
  return requestApiKeys<{ api_key: string; key: UserApiKey }>('POST', { name });
}

export async function revokeUserApiKey(keyId: string): Promise<void> {
  await requestApiKeys<Record<string, unknown>>('DELETE', undefined, keyId);
}

export async function updateWhitelistSetting(whitelist_enabled: boolean): Promise<void> {
  await requestAdmin<Record<string, unknown>>('PUT', { whitelist_enabled });
}

export async function addAdminAccessEntry(
  action: 'whitelist' | 'blacklist' | 'admin',
  email: string,
  reason?: string
): Promise<void> {
  await requestAdmin<Record<string, unknown>>('POST', { action, email, reason });
}

export async function grantAdminAppAccess(user_id: string, app_slug: string): Promise<void> {
  await requestAdmin<Record<string, unknown>>('POST', {
    action: 'grant_app',
    user_id,
    app_slug
  });
}

export async function updateAdminAlphaRequest(
  user_id: string,
  action: 'approve_alpha' | 'reject_alpha' | 'retry_alpha_notification'
): Promise<void> {
  await requestAdmin<Record<string, unknown>>('POST', { action, user_id });
}

export async function setAdminAllProjectsAccess(
  user_id: string,
  enabled: boolean
): Promise<void> {
  await requestAdmin<Record<string, unknown>>('POST', {
    action: 'all_projects',
    user_id,
    enabled
  });
}

export async function revokeAdminAppAccess(user_id: string, app_slug: string): Promise<void> {
  const params = new URLSearchParams({ action: 'app', user_id, app_slug });
  await requestAdmin<Record<string, unknown>>('DELETE', undefined, params);
}

export async function kickAdminUser(user_id: string, blacklist = false): Promise<void> {
  await requestAdmin<Record<string, unknown>>('POST', {
    action: blacklist ? 'blacklist_user' : 'kick',
    user_id
  });
}

export async function removeAdminAccessEntry(
  action: 'whitelist' | 'blacklist' | 'admin',
  identifier: string
): Promise<void> {
  const params = new URLSearchParams({ action });
  params.set(action === 'admin' ? 'user_id' : 'email', identifier);
  await requestAdmin<Record<string, unknown>>('DELETE', undefined, params);
}
