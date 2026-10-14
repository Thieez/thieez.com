import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadPageData } from '$lib/server/home-load';

export const load: PageServerLoad = ({ cookies, setHeaders, url }) => {
  const hostname = url.hostname.toLowerCase();
  if (
    hostname !== 'thieez.com' &&
    hostname !== 'api.thieez.com' &&
    hostname.endsWith('.thieez.com')
  ) {
    redirect(308, `https://thieez.com${url.pathname}${url.search}`);
  }

  return loadPageData(setHeaders, url, Boolean(cookies.get('thieez_refresh')));
};
