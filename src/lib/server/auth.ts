import { API_BASE } from '$lib/api';
import type { AuthUser } from '$lib/api';
import type { Cookies } from '@sveltejs/kit';

const AUTH_BASE = `${API_BASE}/auth/v0`;
const ACCESS_COOKIE = 'thieez_access';
const ACCESS_EXPIRY_COOKIE = 'thieez_access_expires';
const REFRESH_COOKIE = 'thieez_refresh';
const DEVICE_COOKIE = 'thieez_device_id';
const COOKIE_SCOPE_COOKIE = 'thieez_cookie_scope';
const SESSION_INACTIVITY_DAYS = 30;
const SESSION_INACTIVITY_SECONDS = SESSION_INACTIVITY_DAYS * 24 * 60 * 60;
const REFRESH_REQUEST_REUSE_MS = 30_000;
const PROFILE_CACHE_TTL_MS = 60_000;
const PROFILE_CACHE_MAX_ENTRIES = 500;

type RefreshedTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

type CachedProfile = {
  user: AuthUser;
  expiresAt: number;
};

type RefreshRequest = {
  refreshToken: string;
  promise: Promise<RefreshedTokens | null>;
  completedAt: number | null;
};

const refreshRequests = new Map<string, RefreshRequest>();
const profileCache = new Map<string, CachedProfile>();

async function profileCacheKey(accessToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pruneProfileCache(now: number): void {
  for (const [key, profile] of profileCache) {
    if (profile.expiresAt <= now) profileCache.delete(key);
  }
  while (profileCache.size > PROFILE_CACHE_MAX_ENTRIES) {
    const oldestKey = profileCache.keys().next().value;
    if (oldestKey === undefined) break;
    profileCache.delete(oldestKey);
  }
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter: string | null
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

type CookieOptions = {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  domain?: string;
};

function sharedCookieDomain(url: URL): string | undefined {
  const hostname = url.hostname.toLowerCase();
  return hostname === 'thieez.com' || hostname.endsWith('.thieez.com')
    ? '.thieez.com'
    : undefined;
}

function cookieOptions(url: URL): CookieOptions {
  return {
    path: '/',
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    ...(sharedCookieDomain(url) ? { domain: sharedCookieDomain(url) } : {})
  };
}

function extendSessionCookieLifetimes(cookies: Cookies, url: URL, refreshToken: string, deviceId: string): void {
  const options = cookieOptions(url);
  cookies.set(REFRESH_COOKIE, refreshToken, {
    ...options,
    maxAge: SESSION_INACTIVITY_SECONDS
  });
  cookies.set(DEVICE_COOKIE, deviceId, {
    ...options,
    maxAge: SESSION_INACTIVITY_SECONDS
  });
  if (sharedCookieDomain(url)) {
    cookies.set(COOKIE_SCOPE_COOKIE, 'shared', {
      ...options,
      maxAge: SESSION_INACTIVITY_SECONDS
    });
  }
}

export function clearAuthCookies(cookies: Cookies, url: URL): void {
  const options = cookieOptions(url);
  const legacyOptions = { path: '/' };
  for (const name of [
    ACCESS_COOKIE,
    ACCESS_EXPIRY_COOKIE,
    REFRESH_COOKIE,
    COOKIE_SCOPE_COOKIE
  ]) {
    cookies.delete(name, legacyOptions);
    cookies.delete(name, options);
  }
}

export function ensureDeviceIdCookie(cookies: Cookies, url: URL): string {
  const existing = cookies.get(DEVICE_COOKIE);
  if (existing) return existing;
  const deviceId = crypto.randomUUID();
  cookies.set(DEVICE_COOKIE, deviceId, {
    ...cookieOptions(url),
    maxAge: SESSION_INACTIVITY_SECONDS
  });
  return deviceId;
}

export function setAuthCookies(
  cookies: Cookies,
  url: URL,
  tokens: { access_token: string; refresh_token: string; expires_in: number },
  deviceId: string
): void {
  const options = cookieOptions(url);
  const now = Date.now();
  for (const name of [ACCESS_COOKIE, ACCESS_EXPIRY_COOKIE, REFRESH_COOKIE, DEVICE_COOKIE]) {
    cookies.delete(name, { path: '/' });
  }
  cookies.set(ACCESS_COOKIE, tokens.access_token, {
    ...options,
    maxAge: SESSION_INACTIVITY_SECONDS
  });
  cookies.set(ACCESS_EXPIRY_COOKIE, String(now + tokens.expires_in * 1000), {
    ...options,
    maxAge: SESSION_INACTIVITY_SECONDS
  });
  cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
    ...options,
    maxAge: SESSION_INACTIVITY_SECONDS
  });
  cookies.set(DEVICE_COOKIE, deviceId, {
    ...options,
    maxAge: SESSION_INACTIVITY_SECONDS
  });
  if (sharedCookieDomain(url)) {
    cookies.set(COOKIE_SCOPE_COOKIE, 'shared', {
      ...options,
      maxAge: SESSION_INACTIVITY_SECONDS
    });
  }
}

export async function getAccessToken(
  cookies: Cookies,
  url: URL,
  fetcher: typeof fetch,
  forceRefresh = false
): Promise<string | null> {
  const accessToken = cookies.get(ACCESS_COOKIE);
  const expiresAt = Number(cookies.get(ACCESS_EXPIRY_COOKIE));
  if (
    !forceRefresh &&
    accessToken &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + 60_000
  ) {
    const refreshToken = cookies.get(REFRESH_COOKIE);
    const deviceId = cookies.get(DEVICE_COOKIE);
    if (
      sharedCookieDomain(url) &&
      cookies.get(COOKIE_SCOPE_COOKIE) !== 'shared' &&
      refreshToken &&
      deviceId
    ) {
      setAuthCookies(cookies, url, {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: Math.floor((expiresAt - Date.now()) / 1000)
      }, deviceId);
    } else if (refreshToken && deviceId) {
      extendSessionCookieLifetimes(cookies, url, refreshToken, deviceId);
    }
    return accessToken;
  }

  const refreshToken = cookies.get(REFRESH_COOKIE);
  const deviceId = cookies.get(DEVICE_COOKIE);
  if (!refreshToken || !deviceId) {
    clearAuthCookies(cookies, url);
    return null;
  }

  for (const [pendingDeviceId, pendingRequest] of refreshRequests) {
    if (
      pendingRequest.completedAt !== null &&
      Date.now() - pendingRequest.completedAt > REFRESH_REQUEST_REUSE_MS
    ) {
      refreshRequests.delete(pendingDeviceId);
    }
  }

  let refreshRequest = refreshRequests.get(deviceId);
  if (
    refreshRequest &&
    (
      refreshRequest.refreshToken !== refreshToken ||
      (
        refreshRequest.completedAt !== null &&
        Date.now() - refreshRequest.completedAt > REFRESH_REQUEST_REUSE_MS
      )
    )
  ) {
    refreshRequests.delete(deviceId);
    refreshRequest = undefined;
  }
  if (!refreshRequest) {
    const request: RefreshRequest = {
      refreshToken,
      completedAt: null,
      promise: (async () => {
        const response = await fetcher(`${AUTH_BASE}/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken, device_id: deviceId })
        });
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok) {
          throw new AuthApiError(
            `Auth API refresh failed (${response.status})`,
            response.status,
            response.headers.get('Retry-After')
          );
        }

        const tokens = (await response.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };
        if (
          typeof tokens.access_token !== 'string' ||
          !tokens.access_token ||
          typeof tokens.refresh_token !== 'string' ||
          !tokens.refresh_token ||
          typeof tokens.expires_in !== 'number' ||
          !Number.isFinite(tokens.expires_in) ||
          !Number.isInteger(tokens.expires_in) ||
          tokens.expires_in <= 0 ||
          tokens.expires_in > 86_400
        ) {
          throw new Error('Auth API returned an invalid refreshed session');
        }
        return {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: tokens.expires_in
        };
      })()
    };
    refreshRequest = request;
    refreshRequests.set(deviceId, request);
    void request.promise.then(
      () => { request.completedAt = Date.now(); },
      () => { request.completedAt = Date.now(); }
    );
  }

  const tokens = await refreshRequest.promise;
  if (!tokens) {
    clearAuthCookies(cookies, url);
    return null;
  }

  setAuthCookies(cookies, url, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in
  }, deviceId);
  return tokens.access_token;
}

export async function fetchWithAuthRefresh(
  cookies: Cookies,
  url: URL,
  fetcher: typeof fetch,
  send: (accessToken: string) => Promise<Response>,
  initialAccessToken?: string
): Promise<Response | null> {
  let accessToken = initialAccessToken ?? await getAccessToken(cookies, url, fetcher);
  if (!accessToken) return null;

  let response = await send(accessToken);
  if (response.status !== 401) return response;

  accessToken = await getAccessToken(cookies, url, fetcher, true);
  if (!accessToken) {
    clearAuthCookies(cookies, url);
    return null;
  }

  response = await send(accessToken);
  if (response.status === 401) clearAuthCookies(cookies, url);
  return response;
}

export async function retryTransientRequest(
  send: () => Promise<Response | null>
): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await send();
      if (!response || response.status < 500 || attempt === 1) return response;
    } catch (cause) {
      if (attempt === 1) throw cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export async function getCurrentUser(
  cookies: Cookies,
  url: URL,
  fetcher: typeof fetch,
  forceProfileRefresh = false
): Promise<{ accessToken: string; user: AuthUser } | null> {
  let accessToken = await getAccessToken(cookies, url, fetcher);
  if (!accessToken) return null;

  const cacheKey = await profileCacheKey(accessToken);
  const now = Date.now();
  pruneProfileCache(now);
  const cachedProfile = profileCache.get(cacheKey);
  if (!forceProfileRefresh && cachedProfile && cachedProfile.expiresAt > now) {
    return { accessToken, user: { ...cachedProfile.user } };
  }

  const deviceId = cookies.get(DEVICE_COOKIE);
  let response = await fetcher(`${AUTH_BASE}/me?include_stats=false`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Device-Id': deviceId ?? '',
      'X-Device-Name': 'Thieez Website'
    }
  });
  if (response.status === 401 || response.status === 403) {
    const refreshedToken = await getAccessToken(cookies, url, fetcher, true);
    if (!refreshedToken) {
      clearAuthCookies(cookies, url);
      return null;
    }
    accessToken = refreshedToken;
    response = await fetcher(`${AUTH_BASE}/me?include_stats=false`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${refreshedToken}`,
        'X-Device-Id': deviceId ?? '',
        'X-Device-Name': 'Thieez Website'
      }
    });
    if (response.status === 401 || response.status === 403) {
      clearAuthCookies(cookies, url);
      return null;
    }
  }
  if (response.status === 403) {
    clearAuthCookies(cookies, url);
    return null;
  }
  if (!response.ok) {
    throw new AuthApiError(
      `Auth API profile request failed (${response.status})`,
      response.status,
      response.headers.get('Retry-After')
    );
  }

  const payload = (await response.json()) as { user?: AuthUser; is_admin?: boolean };
  if (!payload.user) throw new Error('Auth API returned no user profile');

  const user = { ...payload.user, is_admin: payload.is_admin === true };
  profileCache.set(await profileCacheKey(accessToken), {
    user,
    expiresAt: Date.now() + PROFILE_CACHE_TTL_MS
  });
  pruneProfileCache(Date.now());

  return {
    accessToken,
    user
  };
}
