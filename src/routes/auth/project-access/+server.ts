import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { fetchWithAuthRefresh, getCurrentUser } from '$lib/server/auth';

export const GET: RequestHandler = async ({ cookies, fetch, url }) => {
  try {
    const session = await getCurrentUser(cookies, url, fetch);
    if (!session) {
      return json({ detail: 'Not authenticated' }, {
        status: 401,
        headers: { 'cache-control': 'no-store' }
      });
    }

    const response = await fetchWithAuthRefresh(
      cookies,
      url,
      fetch,
      (accessToken) => fetch(`${AUTH_BASE}/project-access`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`
        }
      }),
      session.accessToken
    );
    if (!response) {
      return json({ detail: 'Not authenticated' }, {
        status: 401,
        headers: { 'cache-control': 'no-store' }
      });
    }
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
