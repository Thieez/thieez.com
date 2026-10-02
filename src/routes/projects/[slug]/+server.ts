import { redirect, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { getAccessToken } from '$lib/server/auth';

export const GET: RequestHandler = async ({ cookies, fetch, params, url }) => {
  const routeSlug = params.slug;
  if (!routeSlug) redirect(303, '/');
  const slug = routeSlug.toLowerCase();
  const projectUrl = `https://${slug}.thieez.com/`;
  const deniedUrl = `${projectUrl}?access_denied=true`;
  const failedUrl = `${projectUrl}?access_check_failed=true`;

  try {
    const accessToken = await getAccessToken(cookies, url, fetch);
    if (!accessToken) {
      redirect(303, deniedUrl);
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
      redirect(303, deniedUrl);
    }
    if (!response.ok) {
      console.error('Could not check project access', response.status);
      redirect(303, failedUrl);
    }

    const payload = (await response.json()) as { allowed?: boolean; href?: string };
    if (!payload.allowed || typeof payload.href !== 'string') {
      redirect(303, deniedUrl);
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
    redirect(303, failedUrl);
  }
};
