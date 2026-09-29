import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { clearAuthCookies, getAccessToken } from '$lib/server/auth';

export const POST: RequestHandler = async ({ cookies, fetch, url }) => {
  try {
    const accessToken = await getAccessToken(cookies, url, fetch);
    const deviceId = cookies.get('thieez_device_id');
    if (accessToken) {
      const response = await fetch(`${AUTH_BASE}/logout`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Device-Id': deviceId ?? ''
        }
      });
      if (!response.ok) throw new Error(`Auth API logout failed (${response.status})`);
    }
    clearAuthCookies(cookies, url);
    return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    clearAuthCookies(cookies, url);
    console.error('Could not revoke website auth session', cause);
    return json({ error: 'The local session was cleared, but API logout failed.' }, {
      status: 502,
      headers: { 'cache-control': 'no-store' }
    });
  }
};
