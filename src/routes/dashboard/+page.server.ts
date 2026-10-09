import type { PageServerLoad } from './$types';
import { loadPageData } from '$lib/server/home-load';

export const load: PageServerLoad = ({ cookies, setHeaders, url }) =>
  loadPageData(setHeaders, url, Boolean(cookies.get('thieez_refresh')));
