import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { fetchWithAuthRefresh, retryTransientRequest } from '$lib/server/auth';

async function proxyAccessRequest({
  cookies,
  fetch,
  request,
  url
}: Parameters<RequestHandler>[0]): Promise<Response> {
  try {
    const resource = url.searchParams.get('resource');
    const apiPath = resource === 'devices' ? '/admin/access/devices' : '/admin/access';
    const apiQuery = new URLSearchParams(url.searchParams);
    apiQuery.delete('resource');
    const queryString = apiQuery.toString();
    const method = request.method;
    const body = method === 'POST' || method === 'PUT' ? await request.text() : undefined;
    const send = () =>
      fetchWithAuthRefresh(cookies, url, fetch, (accessToken) =>
        fetch(`${AUTH_BASE}${apiPath}${queryString ? `?${queryString}` : ''}`, {
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
    console.error('Could not proxy API access management request', cause);
    return json({ detail: 'Could not manage API access.' }, {
      status: 502,
      headers: { 'cache-control': 'no-store' }
    });
  }
}

export const GET: RequestHandler = proxyAccessRequest;
export const PUT: RequestHandler = proxyAccessRequest;
export const POST: RequestHandler = proxyAccessRequest;
export const DELETE: RequestHandler = proxyAccessRequest;
