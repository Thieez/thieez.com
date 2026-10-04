import { redirect, type RequestHandler } from '@sveltejs/kit';
import { clearAuthCookies, getAccessToken } from '$lib/server/auth';

function safeProjectUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const target = new URL(value);
    if (
      target.protocol !== 'https:' ||
      !target.hostname.toLowerCase().endsWith('.thieez.com') ||
      target.hostname.toLowerCase() === 'api.thieez.com' ||
      target.username ||
      target.password
    ) {
      return null;
    }
    return target;
  } catch {
    return null;
  }
}

export const GET: RequestHandler = async ({ cookies, fetch, url }) => {
  const target = safeProjectUrl(url.searchParams.get('return_to'));
  if (!target) redirect(303, '/');

  try {
    const accessToken = await getAccessToken(cookies, url, fetch, true);
    if (accessToken) {
      const projectSlug = target.hostname.split('.')[0];
      return new Response(null, {
        status: 303,
        headers: {
          location: `https://thieez.com/projects/${encodeURIComponent(projectSlug)}`,
          'cache-control': 'no-store, max-age=0'
        }
      });
    }
  } catch (cause) {
    console.error('Could not share website session with project subdomain', cause);
  }

  clearAuthCookies(cookies, url);
  target.searchParams.set('session_transfer', 'failed');
  return new Response(null, {
    status: 303,
    headers: {
      location: target.href,
      'cache-control': 'no-store, max-age=0'
    }
  });
};
