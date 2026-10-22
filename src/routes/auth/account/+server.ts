import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { clearAuthCookies, getAccessToken } from '$lib/server/auth';

export const DELETE: RequestHandler = async ({ cookies, fetch, url }) => {
  try {
    const accessToken = await getAccessToken(cookies, url, fetch);
    if (!accessToken) {
      return json({ error: 'Not authenticated' }, {
        status: 401,
        headers: { 'cache-control': 'no-store' }
      });
    }

    const response = await fetch(`${AUTH_BASE}/account`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const body = await response.text();
    let payload: unknown = { ok: true };
    if (body) {
      try {
        payload = JSON.parse(body);
      } catch {
        payload = { error: 'Account deletion failed.' };
      }
    }
    if (!response.ok) {
      return json(payload, {
        status: response.status,
        headers: { 'cache-control': 'no-store' }
      });
    }

    clearAuthCookies(cookies, url);
    return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    console.error('Could not delete Thieez account', cause);
    return json({ error: 'Could not delete your account. Please try again.' }, {
      status: 502,
      headers: { 'cache-control': 'no-store' }
    });
  }
};
