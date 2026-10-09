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
    !url.searchParams.has('session_transfer') &&
    (
      !cookies.get('thieez_access') ||
      cookies.get('thieez_cookie_scope') !== 'shared'
    )
  ) {
    await getAccessToken(cookies, url, fetch);
  }
  return loadPageData(setHeaders, url);
};
