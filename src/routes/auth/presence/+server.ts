import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { clearAuthCookies, getAccessToken } from '$lib/server/auth';

export const POST: RequestHandler = async ({ cookies, fetch, url }) => {
  try {
    const accessToken = await getAccessToken(cookies, url, fetch);
    if (!accessToken) {
      return json({ detail: 'Not authenticated' }, {
        status: 401,
        headers: { 'cache-control': 'no-store' }
      });
    }

    const response = await fetch(`${AUTH_BASE}/presence/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 401 || response.status === 403) {
      clearAuthCookies(cookies, url);
    }
    if (!response.ok) {
      return json({ detail: 'Could not update presence.' }, {
        status: response.status,
        headers: { 'cache-control': 'no-store' }
      });
    }
    return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    console.error('Could not update website user presence', cause);
    return json({ detail: 'Could not update presence.' }, {
      status: 502,
      headers: { 'cache-control': 'no-store' }
    });
  }
};
