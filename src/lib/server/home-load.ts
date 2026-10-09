import { API_BASE } from '$lib/api';
import type {
  DatabaseStorage,
  LatestBuild,
  PluginBuild,
  Project,
  ProjectResult,
  RenderLimits
} from '$lib/api';
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
const pendingRequests = new Map<string, Promise<unknown>>();
type ProjectReleaseStatus = 'released' | 'unreleased' | 'unpublished' | 'unavailable' | null;

function refreshCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const pending = pendingRequests.get(key);
  if (pending) return pending as Promise<T>;

  const request = fetcher()
    .then((value) => {
      cache.set(key, { value, updatedAt: Date.now() });
      return value;
    })
    .finally(() => {
      pendingRequests.delete(key);
    });
  pendingRequests.set(key, request);
  return request;
}

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

  if (previous) {
    void refreshCached(key, fetcher).catch((cause) => {
      console.error(`Could not refresh cached page data (${key})`, cause);
    });
    return {
      value: previous.value as T,
      stale: true,
      updatedAt: new Date(previous.updatedAt).toISOString(),
      error: null
    };
  }

  try {
    const value = await refreshCached(key, fetcher);
    const updatedAt = Date.now();
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

async function loadProjects(fetcher: typeof fetch): Promise<CachedResult<ProjectResult>> {
  return cached<ProjectResult>('projects', async () => {
    try {
      const payload = await fetchJson<Project[] | { projects?: Project[] }>(fetcher, '/projects/v0');
      return { projects: Array.isArray(payload) ? payload : payload.projects ?? [], source: 'api' };
    } catch (cause) {
      const status = cause instanceof Error ? Number(cause.message.match(/\d+/)?.[0]) : undefined;
      if (status === 404 || status === 405) return { projects: [], source: 'fallback' };
      throw cause;
    }
  });
}

export async function loadPageData(
  fetcher: typeof fetch,
  setHeaders: (headers: Record<string, string>) => void,
  url: URL
) {
  const isDashboard = url.pathname === '/dashboard';
  const isAccount = url.pathname === '/account';
  const hostname = url.hostname.toLowerCase();
  const hostProject = hostname.endsWith('.thieez.com')
    ? hostname.slice(0, -'.thieez.com'.length)
    : '';
  const accessDenied =
    url.searchParams.has('access_denied') ||
    (url.searchParams.get('session_transfer') === 'failed' &&
      hostProject !== '' &&
      hostProject !== 'www' &&
      hostProject !== 'api');
  const accessCheckFailed = url.searchParams.has('access_check_failed');
  const configuredProject = url.searchParams.get('project')?.trim().toLowerCase() || '';
  const projectSlug = configuredProject || (hostProject !== 'www' && hostProject !== 'api' ? hostProject : '');
  const isLisnnto = projectSlug === 'lisnnto';
  const isNote = projectSlug === 'note';
  const projectName = projectSlug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  let projectReleaseStatus: ProjectReleaseStatus = null;
  let projectRelease: CachedResult<LatestBuild> | null = null;
  let publishedProject: Project | null = null;

  if (
    hostProject &&
    hostProject !== 'www' &&
    hostProject !== 'api' &&
    !isDashboard &&
    !isAccount &&
    !accessDenied &&
    !accessCheckFailed
  ) {
    const projectIndex = await loadProjects(fetcher);
    publishedProject = projectIndex.value?.projects.find(
      (project) => project.slug.toLowerCase() === hostProject
    ) ?? null;
    if (publishedProject) {
      const releaseSlug = publishedProject.slug;
      if (typeof publishedProject.released === 'boolean') {
        projectReleaseStatus = publishedProject.released ? 'released' : 'unreleased';
        if (publishedProject.released) {
          projectRelease = await cached<LatestBuild>(
            `release:${releaseSlug}`,
            async () => {
              const release = await fetchJson<LatestBuild>(
                fetcher,
                `/updates/v0/${encodeURIComponent(releaseSlug)}/latest`
              );
              return { ...release, assets: release.assets ?? [] };
            }
          );
        }
      } else {
        projectRelease = await cached<LatestBuild>(
          `release:${releaseSlug}`,
          async () => {
            const release = await fetchJson<LatestBuild>(
              fetcher,
              `/updates/v0/${encodeURIComponent(releaseSlug)}/latest`
            );
            return { ...release, assets: release.assets ?? [] };
          }
        );
        if (projectRelease.value) {
          projectReleaseStatus = 'released';
        } else if (projectRelease.error?.includes('(404)')) {
          projectReleaseStatus = 'unreleased';
        } else {
          console.error('Could not check project release status', projectRelease.error);
          projectReleaseStatus = 'unavailable';
        }
      }
    } else if (projectIndex.error) {
      console.error('Could not load projects to check release status', projectIndex.error);
      projectReleaseStatus = 'unavailable';
    } else {
      projectReleaseStatus = 'unpublished';
    }
  }

  setHeaders(
    isDashboard ||
      isAccount ||
      accessDenied ||
      accessCheckFailed ||
      projectReleaseStatus === 'unreleased' ||
      projectReleaseStatus === 'unpublished' ||
      projectReleaseStatus === 'unavailable' ||
      Boolean(projectRelease?.error)
      ? { 'cache-control': 'no-store' }
      : {
          'cache-control':
            'public, max-age=0, s-maxage=60, stale-while-revalidate=86400, stale-if-error=86400'
        }
  );

  if (accessDenied || accessCheckFailed) {
    return {
      isLisnnto,
      isNote,
      projectSlug,
      projectName,
      build: null,
      projects: null,
      storage: null,
      renderLimits: null,
      accessDenied,
      accessCheckFailed,
      isDashboard,
      isAccount,
      projectReleaseStatus,
      project: publishedProject,
      projectRelease
    };
  }

  if (isDashboard || isAccount) {
    return {
      isLisnnto,
      isNote,
      projectSlug,
      projectName,
      build: null,
      projects: null,
      storage: null,
      renderLimits: null,
      accessDenied,
      accessCheckFailed,
      isDashboard,
      isAccount,
      projectReleaseStatus,
      project: publishedProject,
      projectRelease
    };
  }

  if (isLisnnto || isNote) {
    const build = await cached<LatestBuild | PluginBuild>(`build:${projectSlug}`, async () => {
      if (isNote) {
        try {
          const latest = await fetchJson<PluginBuild>(
            fetcher,
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
        const latest = await fetchJson<LatestBuild>(fetcher, '/updates/v0/latest');
        return { ...latest, assets: latest.assets ?? [] };
      } catch {
        const releases = await fetchJson<Array<LatestBuild>>(fetcher, '/lisnnto/v0/builds');
        const latest = releases[0] ?? { assets: [] };
        return { ...latest, assets: latest.assets ?? [] };
      }
    });
    return {
      isLisnnto,
      isNote,
      projectSlug,
      projectName,
      build,
      projects: null,
      storage: null,
      renderLimits: null,
      accessDenied,
      accessCheckFailed,
      isDashboard,
      isAccount,
      projectReleaseStatus,
      project: publishedProject,
      projectRelease
    };
  }

  const [projects, storage, renderLimits] = await Promise.all([
    loadProjects(fetcher),
    cached<DatabaseStorage>('database-storage', () => fetchJson(fetcher, '/lisnnto/v0/storage')),
    cached<RenderLimits>('render-limits', async () => {
      try {
        return await fetchJson(fetcher, '/render/v0/limits');
      } catch (cause) {
        const status = cause instanceof Error ? Number(cause.message.match(/\d+/)?.[0]) : undefined;
        if (status !== 404 && status !== 405) throw cause;
        return fetchJson(fetcher, '/render/limits');
      }
    })
  ]);

  return {
    isLisnnto,
    isNote,
    projectSlug,
    projectName,
    build: null,
    projects,
    storage,
    renderLimits,
    accessDenied,
    accessCheckFailed,
    isDashboard,
    isAccount,
    projectReleaseStatus,
    project: publishedProject,
    projectRelease
  };
}
