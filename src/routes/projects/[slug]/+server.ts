import { redirect, type RequestHandler } from '@sveltejs/kit';
import { AUTH_BASE } from '$lib/api';
import { getAccessToken } from '$lib/server/auth';

export const GET: RequestHandler = async ({ cookies, fetch, params, url }) => {
  const routeSlug = params.slug;
  if (!routeSlug) redirect(303, '/');
  const slug = routeSlug.toLowerCase();
  const projectUrl = `https://${slug}.thieez.com/`;
  const deniedUrl = (reason: string) =>
    `${projectUrl}?access_denied=${encodeURIComponent(reason)}`;
  const failedUrl = `${projectUrl}?access_check_failed=true`;

  try {
    const accessToken = await getAccessToken(cookies, url, fetch);
    if (!accessToken) {
      redirect(303, deniedUrl('session'));
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
    if (response.status === 401) {
      redirect(303, deniedUrl('session'));
    }
    if (response.status === 403) {
      let reason = 'api';
      try {
        const payload = (await response.json()) as { detail?: string };
        if (payload.detail === 'This account does not have access to this application') {
          reason = 'grant';
        } else if (payload.detail === 'This account is not on the whitelist') {
          reason = 'whitelist';
        } else if (payload.detail === 'This account is blocked') {
          reason = 'blocked';
        }
      } catch {
        reason = 'api';
      }
      redirect(303, deniedUrl(reason));
    }
    if (!response.ok) {
      console.error('Could not check project access', response.status);
      redirect(303, failedUrl);
    }

    const payload = (await response.json()) as {
      allowed?: boolean;
      href?: string;
      reason?: string;
    };
    if (!payload.allowed || typeof payload.href !== 'string') {
      redirect(303, deniedUrl(
        payload.reason === 'Application is not published' ? 'unpublished' : 'grant'
      ));
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
