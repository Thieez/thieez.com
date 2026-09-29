import { error, redirect, type RequestHandler } from '@sveltejs/kit';
import { clearAuthCookies, setAuthCookies } from '$lib/server/auth';

const STATE_COOKIE = 'thieez_oauth_state';

function safeReturnTo(value: string | null, origin: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }
  const target = new URL(value, origin);
  return target.origin === origin ? `${target.pathname}${target.search}${target.hash}` : '/';
}

export const GET: RequestHandler = ({ cookies, url, setHeaders }) => {
  setHeaders({
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer'
  });
  const state = url.searchParams.get('state');
  const expectedState = cookies.get(STATE_COOKIE);
  cookies.delete(STATE_COOKIE, { path: '/' });

  if (!state || !expectedState || state !== expectedState) {
    clearAuthCookies(cookies, url);
    throw error(400, 'The sign-in request expired or could not be verified. Please try again.');
  }

  const accessToken = url.searchParams.get('access_token');
  const refreshToken = url.searchParams.get('refresh_token');
  const expiresIn = Number(url.searchParams.get('expires_in') ?? 3600);
  if (
    !accessToken ||
    !refreshToken ||
    !Number.isInteger(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > 86_400
  ) {
    clearAuthCookies(cookies, url);
    throw error(400, 'The sign-in response was invalid. Please try again.');
  }

  const deviceId = cookies.get('thieez_device_id') || crypto.randomUUID();
  setAuthCookies(cookies, url, {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn
  }, deviceId);

  throw redirect(303, safeReturnTo(url.searchParams.get('return_to'), url.origin));
};
