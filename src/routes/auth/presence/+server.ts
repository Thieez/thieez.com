import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { fetchWithAuthRefresh } from '$lib/server/auth';

export const POST: RequestHandler = async ({ cookies, fetch, url }) => {
  try {
    const response = await fetchWithAuthRefresh(cookies, url, fetch, (accessToken) =>
      fetch(`${AUTH_BASE}/presence/heartbeat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` }
      })
    );
    if (!response) {
      return json({ detail: 'Not authenticated' }, {
        status: 401,
        headers: { 'cache-control': 'no-store' }
      });
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
