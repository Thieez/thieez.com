import { redirect, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { clearAuthCookies, getAccessToken } from '$lib/server/auth';

export const GET: RequestHandler = async ({ cookies, fetch, params, url }) => {
  const routeSlug = params.slug;
  if (!routeSlug) redirect(303, '/?access_check_failed=true');
  const slug = routeSlug.toLowerCase();

  try {
    const accessToken = await getAccessToken(cookies, url, fetch);
    if (!accessToken) {
      redirect(303, `/?access_denied=${encodeURIComponent(slug)}`);
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
      clearAuthCookies(cookies, url);
      redirect(303, `/?access_denied=${encodeURIComponent(slug)}`);
    }
    if (!response.ok) {
      console.error('Could not check project access', response.status);
      redirect(303, '/?access_check_failed=true');
    }

    const payload = (await response.json()) as { allowed?: boolean; href?: string };
    if (!payload.allowed || typeof payload.href !== 'string') {
      redirect(303, `/?access_denied=${encodeURIComponent(slug)}`);
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
    redirect(303, target.href);
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
    console.error('Could not check project access', cause);
    redirect(303, '/?access_check_failed=true');
  }
};
