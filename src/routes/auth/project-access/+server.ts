import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { fetchWithAuthRefresh, getCurrentUser } from '$lib/server/auth';

const RETRY_DELAY_MS = 250;

export const GET: RequestHandler = async ({ cookies, fetch, url }) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
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

      if (response.status >= 500 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }

      const payload = await response.json();
      return json(payload, {
        status: response.status,
        headers: { 'cache-control': 'no-store' }
      });
    } catch (cause) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      console.error('Could not load project access', cause);
    }
  }

  return json({ detail: 'Could not load project access.' }, {
    status: 502,
    headers: { 'cache-control': 'no-store' }
  });
};
