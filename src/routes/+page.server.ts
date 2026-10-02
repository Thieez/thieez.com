import { API_BASE } from '$lib/api';
import type {
  ApiHealth,
  DatabaseStorage,
  LatestBuild,
  PluginBuild,
  Project,
  ProjectResult,
  RenderLimits
} from '$lib/api';
import type { PageServerLoad } from './$types';

const CACHE_TTL_MS = 60_000;

type CachedResult<T> = {
  value: T | null;
  stale: boolean;
  updatedAt: string | null;
  error: string | null;
};

type CacheEntry = {
  value: unknown;
  updatedAt: number;
};

const cache = new Map<string, CacheEntry>();

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<CachedResult<T>> {
  const previous = cache.get(key) as CacheEntry | undefined;
  if (previous && Date.now() - previous.updatedAt < CACHE_TTL_MS) {
    return {
      value: previous.value as T,
      stale: false,
      updatedAt: new Date(previous.updatedAt).toISOString(),
      error: null
    };
  }

  try {
    const value = await fetcher();
    const updatedAt = Date.now();
    cache.set(key, { value, updatedAt });
    return { value, stale: false, updatedAt: new Date(updatedAt).toISOString(), error: null };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : 'The API request failed.';
    return {
      value: previous ? (previous.value as T) : null,
      stale: Boolean(previous),
      updatedAt: previous ? new Date(previous.updatedAt).toISOString() : null,
      error
    };
  }
}

async function fetchJson<T>(fetcher: typeof fetch, path: string): Promise<T> {
  const response = await fetcher(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`API responded with ${response.status}`);
  return response.json() as Promise<T>;
}

export const load: PageServerLoad = async ({ fetch, setHeaders, url }) => {
  const accessDenied = url.searchParams.get('access_denied');
  const accessCheckFailed = url.searchParams.has('access_check_failed');
  setHeaders(
    accessDenied || accessCheckFailed
      ? { 'cache-control': 'no-store' }
      : {
          'cache-control':
            'public, max-age=0, s-maxage=60, stale-while-revalidate=86400, stale-if-error=86400'
        }
  );

  const hostProject = url.hostname.toLowerCase().endsWith('.thieez.com')
    ? url.hostname.slice(0, -'.thieez.com'.length)
    : '';
  const configuredProject = url.searchParams.get('project')?.trim().toLowerCase() || '';
  const projectSlug = configuredProject || (hostProject !== 'www' && hostProject !== 'api' ? hostProject : '');
  const isLisnnto = projectSlug === 'lisnnto';
  const isNote = projectSlug === 'note';
  const projectName = projectSlug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  if (isLisnnto || isNote) {
    const build = await cached<LatestBuild | PluginBuild>(`build:${projectSlug}`, async () => {
      if (isNote) {
        try {
          const latest = await fetchJson<PluginBuild>(
            fetch,
            '/updates/v0/repository/Thieez/note/latest'
          );
          return { ...latest, assets: latest.assets ?? [] };
        } catch (cause) {
          const status = cause instanceof Error ? Number(cause.message.match(/\d+/)?.[0]) : undefined;
          if (status === 404) return { assets: [] };
          throw cause;
        }
      }
      try {
        const latest = await fetchJson<LatestBuild>(fetch, '/updates/v0/latest');
        return { ...latest, assets: latest.assets ?? [] };
      } catch {
        const releases = await fetchJson<Array<LatestBuild>>(fetch, '/lisnnto/v0/builds');
        const latest = releases[0] ?? { assets: [] };
        return { ...latest, assets: latest.assets ?? [] };
      }
    });
    return {
      isLisnnto,
      isNote,
      projectName,
      build,
      projects: null,
      apiHealth: null,
      storage: null,
      renderLimits: null,
      accessDenied,
      accessCheckFailed
    };
  }

  const [projects, apiHealth, storage, renderLimits] = await Promise.all([
    cached<ProjectResult>('projects', async () => {
      try {
        const payload = await fetchJson<Project[] | { projects?: Project[] }>(fetch, '/projects/v0');
        return { projects: Array.isArray(payload) ? payload : payload.projects ?? [], source: 'api' };
      } catch (cause) {
        const status = cause instanceof Error ? Number(cause.message.match(/\d+/)?.[0]) : undefined;
        if (status === 404 || status === 405) return { projects: [], source: 'fallback' };
        throw cause;
      }
    }),
    cached<ApiHealth>('api-health', () => fetchJson(fetch, '/uptime/v0/health')),
    cached<DatabaseStorage>('database-storage', () => fetchJson(fetch, '/lisnnto/v0/storage')),
    cached<RenderLimits>('render-limits', async () => {
      try {
        return await fetchJson(fetch, '/render/v0/limits');
      } catch (cause) {
        const status = cause instanceof Error ? Number(cause.message.match(/\d+/)?.[0]) : undefined;
        if (status !== 404 && status !== 405) throw cause;
        return fetchJson(fetch, '/render/limits');
      }
    })
  ]);

  return {
    isLisnnto,
    isNote,
    projectName,
    build: null,
    projects,
    apiHealth,
    storage,
    renderLimits,
    accessDenied,
    accessCheckFailed
  };
};
