import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { clearAuthCookies, getAccessToken } from '$lib/server/auth';

async function proxyApiKeyRequest({
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

    const method = request.method;
    const query = method === 'DELETE'
      ? `?key_id=${encodeURIComponent(url.searchParams.get('key_id') ?? '')}`
      : '';
    const response = await fetch(`${AUTH_BASE}/api-keys${query}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
      },
      ...(method === 'POST' ? { body: await request.text() } : {})
    });
    const payload = await response.json();
    if (response.status === 401) clearAuthCookies(cookies, url);
    return json(payload, {
      status: response.status,
      headers: { 'cache-control': 'no-store' }
    });
  } catch (cause) {
    console.error('Could not proxy API key management request', cause);
    return json({ detail: 'Could not manage API keys.' }, {
      status: 502,
      headers: { 'cache-control': 'no-store' }
    });
  }
}

export const GET: RequestHandler = proxyApiKeyRequest;
export const POST: RequestHandler = proxyApiKeyRequest;
export const DELETE: RequestHandler = proxyApiKeyRequest;
