import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadPageData } from '$lib/server/home-load';

export const load: PageServerLoad = ({ cookies, fetch, setHeaders, url }) => {
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
    setHeaders({ 'cache-control': 'no-store' });
    const handoff = new URL('https://thieez.com/auth/share-session');
    handoff.searchParams.set('return_to', url.href);
    redirect(303, handoff.href);
  }
  return loadPageData(fetch, setHeaders, url);
};
