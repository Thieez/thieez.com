import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { clearAuthCookies, getAccessToken } from '$lib/server/auth';

export const GET: RequestHandler = async ({ cookies, fetch, url }) => {
  try {
    let accessToken = await getAccessToken(cookies, url, fetch);
    if (!accessToken) {
      return json({ detail: 'Not authenticated' }, {
        status: 401,
        headers: { 'cache-control': 'no-store' }
      });
    }

    const requestProjectAccess = (token: string) => fetch(`${AUTH_BASE}/project-access`, {
      headers: {
        Accept: 'application/json',
        Authorization: `******`
      }
    });
    let response = await requestProjectAccess(accessToken);
    if (response.status === 401) {
      accessToken = await getAccessToken(cookies, url, fetch, true);
      if (!accessToken) {
        return json({ detail: 'Not authenticated' }, {
          status: 401,
          headers: { 'cache-control': 'no-store' }
        });
      }
      response = await requestProjectAccess(accessToken);
    }
    if (response.status === 401) clearAuthCookies(cookies, url);
    const payload = await response.json();
    return json(payload, {
      status: response.status,
      headers: { 'cache-control': 'no-store' }
    });
  } catch (cause) {
    console.error('Could not load project access', cause);
    return json({ detail: 'Could not load project access.' }, {
      status: 502,
      headers: { 'cache-control': 'no-store' }
    });
  }
};
