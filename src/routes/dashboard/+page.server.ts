import type { PageServerLoad } from './$types';
import { loadPageData } from '$lib/server/home-load';

export const load: PageServerLoad = ({ fetch, setHeaders, url }) =>
  loadPageData(fetch, setHeaders, url);
