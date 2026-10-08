import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { fetchWithAuthRefresh, retryTransientRequest } from '$lib/server/auth';

async function proxyApiKeyRequest({
  cookies,
  fetch,
  request,
  url
}: Parameters<RequestHandler>[0]): Promise<Response> {
  try {
    const method = request.method;
    const query = method === 'DELETE'
      ? `?key_id=${encodeURIComponent(url.searchParams.get('key_id') ?? '')}`
      : '';
    const body = method === 'POST' ? await request.text() : undefined;
    const send = () =>
      fetchWithAuthRefresh(cookies, url, fetch, (accessToken) =>
        fetch(`${AUTH_BASE}/api-keys${query}`, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
          },
          ...(body !== undefined ? { body } : {})
        })
      );
    const response = method === 'GET'
      ? await retryTransientRequest(send)
      : await send();
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
