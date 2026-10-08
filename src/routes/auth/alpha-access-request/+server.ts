import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { clearAuthCookies, getAccessToken } from '$lib/server/auth';

async function proxyAlphaAccessRequest({
  cookies,
  fetch,
  request,
  url
}: Parameters<RequestHandler>[0]): Promise<Response> {
  try {
    const accessToken = await getAccessToken(cookies, url, fetch);
    if (!accessToken) {
      return json({ detail: 'Not authenticated' }, {
        status: 401,
        headers: { 'cache-control': 'no-store' }
      });
    }

    const response = await fetch(`${AUTH_BASE}/alpha/access-request`, {
      method: request.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (response.status === 401) clearAuthCookies(cookies, url);
    const payload = await response.json();
    return json(payload, {
      status: response.status,
      headers: { 'cache-control': 'no-store' }
    });
  } catch (cause) {
    console.error('Could not proxy Alpha access request', cause);
    return json({ detail: 'Could not load or submit your Alpha access request.' }, {
      status: 502,
      headers: { 'cache-control': 'no-store' }
    });
  }
}

export const GET: RequestHandler = proxyAlphaAccessRequest;
export const POST: RequestHandler = proxyAlphaAccessRequest;
