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
    maxAge: SESSION_INACTIVITY_DAYS * 24 * 60 * 60
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
    maxAge: tokens.expires_in
  });
  cookies.set(ACCESS_EXPIRY_COOKIE, String(now + tokens.expires_in * 1000), {
    ...options,
    maxAge: tokens.expires_in
  });
  cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
    ...options,
    maxAge: SESSION_INACTIVITY_DAYS * 24 * 60 * 60
  });
  cookies.set(DEVICE_COOKIE, deviceId, {
    ...options,
    maxAge: SESSION_INACTIVITY_DAYS * 24 * 60 * 60
  });
  if (sharedCookieDomain(url)) {
    cookies.set(COOKIE_SCOPE_COOKIE, 'shared', {
      ...options,
      maxAge: SESSION_INACTIVITY_DAYS * 24 * 60 * 60
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
    }
    return accessToken;
  }

  const refreshToken = cookies.get(REFRESH_COOKIE);
  const deviceId = cookies.get(DEVICE_COOKIE);
  if (!refreshToken || !deviceId) {
    clearAuthCookies(cookies, url);
    return null;
  }

  const response = await fetcher(`${AUTH_BASE}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken, device_id: deviceId })
  });
  if (response.status === 401 || response.status === 403) {
    clearAuthCookies(cookies, url);
    return null;
  }
  if (!response.ok) throw new Error(`Auth API refresh failed (${response.status})`);

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

  setAuthCookies(cookies, url, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in
  }, deviceId);
  return tokens.access_token;
}

export async function getCurrentUser(
  cookies: Cookies,
  url: URL,
  fetcher: typeof fetch
): Promise<{ accessToken: string; user: AuthUser } | null> {
  const accessToken = await getAccessToken(cookies, url, fetcher);
  if (!accessToken) return null;

  const deviceId = cookies.get(DEVICE_COOKIE);
  let response = await fetcher(`${AUTH_BASE}/me`, {
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
    response = await fetcher(`${AUTH_BASE}/me`, {
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
  if (!response.ok) throw new Error(`Auth API profile request failed (${response.status})`);

  const payload = (await response.json()) as { user?: AuthUser; is_admin?: boolean };
  if (!payload.user) throw new Error('Auth API returned no user profile');

  const refreshToken = cookies.get(REFRESH_COOKIE);
  if (refreshToken && deviceId) {
    cookies.set(REFRESH_COOKIE, refreshToken, {
      ...cookieOptions(url),
      maxAge: SESSION_INACTIVITY_DAYS * 24 * 60 * 60
    });
    cookies.set(DEVICE_COOKIE, deviceId, {
      ...cookieOptions(url),
      maxAge: SESSION_INACTIVITY_DAYS * 24 * 60 * 60
    });
  }
  return {
    accessToken: cookies.get(ACCESS_COOKIE) ?? accessToken,
    user: { ...payload.user, is_admin: payload.is_admin === true }
  };
}
