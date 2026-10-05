import { redirect, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { ensureDeviceIdCookie } from '$lib/server/auth';

const STATE_COOKIE = 'thieez_oauth_state';

function safeReturnTo(value: string | null, origin: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }
  const target = new URL(value, origin);
  return target.origin === origin ? `${target.pathname}${target.search}${target.hash}` : '/';
}

export const GET: RequestHandler = ({ cookies, url }) => {
  const state = crypto.randomUUID();
  const deviceId = ensureDeviceIdCookie(cookies, url);
  const returnTo = safeReturnTo(url.searchParams.get('return_to'), url.origin);
  const callback = new URL('/auth/callback', url.origin);
  callback.searchParams.set('state', state);
  callback.searchParams.set('return_to', returnTo);
  callback.searchParams.set('device_id', deviceId);

  cookies.set(STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 10 * 60
  });

  const login = new URL(`${AUTH_BASE}/login`);
  login.searchParams.set('redirect_to', callback.toString());
  throw redirect(303, login.toString());
};
