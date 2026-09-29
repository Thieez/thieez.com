import { json, type RequestHandler } from '@sveltejs/kit';
import { API_BASE } from '$lib/api';
import { clearAuthCookies, getAccessToken } from '$lib/server/auth';

export const GET: RequestHandler = async ({ cookies, fetch, url }) => {
  try {
    const accessToken = await getAccessToken(cookies, url, fetch);
    if (!accessToken) {
      return json({ error: 'Not authenticated' }, {
        status: 401,
        headers: { 'cache-control': 'no-store' }
      });
    }

    const response = await fetch(`${API_BASE}/lisnnto/v0/limits`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      return json({ error: `Could not load Lisnnto limits (${response.status})` }, {
        status: response.status,
        headers: { 'cache-control': 'no-store' }
      });
    }
    return json(await response.json(), { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    console.error('Could not load authenticated Lisnnto limits', cause);
    return json({ error: 'Could not load Lisnnto limits.' }, {
      status: 502,
      headers: { 'cache-control': 'no-store' }
    });
  }
};
