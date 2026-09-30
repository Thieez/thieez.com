import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { clearAuthCookies, getAccessToken } from '$lib/server/auth';

async function proxyAccessRequest({
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

    const response = await fetch(`${AUTH_BASE}/admin/access${url.search}`, {
      method: request.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(request.method === 'POST' || request.method === 'PUT'
          ? { 'Content-Type': 'application/json' }
          : {})
      },
      ...(request.method === 'POST' || request.method === 'PUT'
        ? { body: await request.text() }
        : {})
    });
    const payload = await response.json();
    if (response.status === 401) {
      clearAuthCookies(cookies, url);
    }
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
