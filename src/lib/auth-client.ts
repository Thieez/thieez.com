import type { AuthUser } from '$lib/api';

const REQUEST_TIMEOUT_MS = 15_000;

export type AuthSession = {
  user: AuthUser | null;
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
  const payload = (await response.json()) as { user?: AuthUser | null };
  return payload.user ? { user: payload.user } : null;
}

export async function logout(): Promise<void> {
  const response = await request('/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error(`Could not log out (${response.status})`);
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
