import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadPageData } from '$lib/server/home-load';
import { getAccessToken } from '$lib/server/auth';

export const load: PageServerLoad = async ({ cookies, fetch, setHeaders, url }) => {
  const hostname = url.hostname.toLowerCase();
  const projectHost = hostname.endsWith('.thieez.com')
    ? hostname.slice(0, -'.thieez.com'.length)
    : '';
  if (
    projectHost &&
    projectHost !== 'www' &&
    projectHost !== 'api' &&
    !url.searchParams.has('access_denied') &&
    !url.searchParams.has('access_check_failed') &&
    !url.searchParams.has('session_transfer') &&
    (
      !cookies.get('thieez_access') ||
      cookies.get('thieez_cookie_scope') !== 'shared'
    )
  ) {
    const accessToken = await getAccessToken(cookies, url, fetch);
    if (!accessToken) {
      setHeaders({ 'cache-control': 'no-store' });
      const deniedUrl = new URL(url);
      deniedUrl.searchParams.set('access_denied', 'true');
      redirect(303, deniedUrl.href);
    }
  }
  return loadPageData(setHeaders, url);
};
