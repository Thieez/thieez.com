import type {
  DatabaseStorage,
  LatestBuild,
  PluginBuild,
  Project,
  ProjectResult,
  RenderLimits
} from '$lib/api';

type CachedResult<T> = {
  value: T | null;
  stale: boolean;
  updatedAt: string | null;
  error: string | null;
};

type ProjectReleaseStatus = 'released' | 'unreleased' | 'unpublished' | 'unavailable' | null;

type HomePageData = {
  isLisnnto: boolean;
  isNote: boolean;
  projectSlug: string;
  projectName: string;
  build: CachedResult<LatestBuild | PluginBuild> | null;
  projects: CachedResult<ProjectResult> | null;
  storage: CachedResult<DatabaseStorage> | null;
  renderLimits: CachedResult<RenderLimits> | null;
  accessDenied: boolean;
  accessCheckFailed: boolean;
  isDashboard: boolean;
  isAccount: boolean;
  isProjectHost: boolean;
  projectReleaseStatus: ProjectReleaseStatus;
  project: Project | null;
  projectRelease: CachedResult<LatestBuild> | null;
};

export function loadPageData(
  setHeaders: (headers: Record<string, string>) => void,
  url: URL
): HomePageData {
  const isDashboard = url.pathname === '/dashboard';
  const isAccount = url.pathname === '/account';
  const hostname = url.hostname.toLowerCase();
  const hostProject = hostname.endsWith('.thieez.com')
    ? hostname.slice(0, -'.thieez.com'.length)
    : '';
  const isProjectHost = hostProject !== '' && hostProject !== 'www' && hostProject !== 'api';
  const accessDenied =
    url.searchParams.has('access_denied') ||
    (url.searchParams.get('session_transfer') === 'failed' &&
      isProjectHost);
  const accessCheckFailed = url.searchParams.has('access_check_failed');
  const configuredProject = url.searchParams.get('project')?.trim().toLowerCase() || '';
  const projectSlug =
    configuredProject || (hostProject !== 'www' && hostProject !== 'api' ? hostProject : '');
  const isLisnnto = projectSlug === 'lisnnto';
  const isNote = projectSlug === 'note';
  const projectName = projectSlug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  setHeaders(
    isDashboard || isAccount || accessDenied || accessCheckFailed
      ? { 'cache-control': 'no-store' }
      : {
          'cache-control':
            'public, max-age=0, s-maxage=60, stale-while-revalidate=86400, stale-if-error=86400'
        }
  );

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
    isProjectHost,
    projectReleaseStatus: null,
    project: null,
    projectRelease: null
  };
}
