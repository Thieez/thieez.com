import type { RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { getAccessToken } from '$lib/server/auth';

function redirectNoStore(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'no-store, max-age=0'
    }
  });
}

export const GET: RequestHandler = async ({ cookies, fetch, params, url }) => {
  const routeSlug = params.slug;
  if (!routeSlug) return redirectNoStore('/');
  const slug = routeSlug.toLowerCase();
  const projectUrl = `https://${slug}.thieez.com/`;
  const deniedUrl = `${projectUrl}?access_denied=true`;
  const failedUrl = `${projectUrl}?access_check_failed=true`;

  try {
    const accessToken = await getAccessToken(cookies, url, fetch);
    if (!accessToken) {
      return redirectNoStore(deniedUrl);
    }

    const response = await fetch(
      `${AUTH_BASE}/app-access?app_slug=${encodeURIComponent(slug)}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `******`
        }
      }
    );
    if (response.status === 401 || response.status === 403) {
      return redirectNoStore(deniedUrl);
    }
    if (!response.ok) {
      console.error('Could not check project access', response.status);
      return redirectNoStore(failedUrl);
    }

    const payload = (await response.json()) as { allowed?: boolean; href?: string };
    if (!payload.allowed || typeof payload.href !== 'string') {
      return redirectNoStore(deniedUrl);
    }

    const target = new URL(payload.href);
    if (
      target.protocol !== 'https:' ||
      !target.hostname.toLowerCase().endsWith('.thieez.com') ||
      target.username ||
      target.password
    ) {
      throw new Error('API returned an invalid project URL');
    }
    return redirectNoStore(target.href);
  } catch (cause) {
    console.error('Could not check project access', cause);
    return redirectNoStore(failedUrl);
  }
};
