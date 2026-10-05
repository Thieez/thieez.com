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
  users: Array<{
    user_id: string;
    email: string | null;
    name: string | null;
    is_online: boolean;
    last_active_at: string | null;
    is_admin: boolean;
    app_slugs: string[];
  }>;
  page: number;
  page_size: number;
  has_more: boolean;
  admins: Array<{ user_id: string; email: string | null; name: string | null }>;
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
  if (!response.ok) throw new Error(`Could not restore session (${response.status})`);
  const payload = (await response.json()) as { user?: AuthUser | null; is_admin?: boolean };
  return payload.user
    ? { user: { ...payload.user, is_admin: payload.is_admin === true } }
    : null;
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

async function requestAdmin<T>(
  method: string,
  body?: Record<string, unknown>,
  query?: URLSearchParams
): Promise<T> {
  const response = await request(`/admin/access${query ? `?${query}` : ''}`, {
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
