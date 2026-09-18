export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, '') || 'https://api.thieez.com';
export const AUTH_BASE = `${API_BASE}/auth/v0`;

const AUTH_STORAGE_KEY = 'thieez.auth';
const DEVICE_STORAGE_KEY = 'thieez.device_id';

export type AuthUser = {
  id?: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  [key: string]: unknown;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: AuthUser | null;
};

export type ApiAsset = {
  name: string;
  browser_download_url?: string;
  download_url?: string;
  digest?: string;
};

export type Project = {
  slug: string;
  name: string;
  description: string;
  href: string;
  status: string;
  meta: string;
};

export type ProjectResult = {
  projects: Project[];
  source: 'api' | 'fallback';
};

export type LatestBuild = {
  tag_name?: string;
  published_at?: string;
  assets: ApiAsset[];
};

export type PluginBuild = LatestBuild;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function getDeviceId(): string {
  if (!isBrowser()) return '';
  const existing = localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_STORAGE_KEY, id);
  return id;
}

function readSession(): AuthSession | null {
  if (!isBrowser()) return null;
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

function writeSession(session: AuthSession | null): void {
  if (!isBrowser()) return;
  if (session) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(AUTH_STORAGE_KEY);
}

async function fetchUser(accessToken: string): Promise<AuthUser> {
  const response = await fetch(`${AUTH_BASE}/me`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Device-Id': getDeviceId(),
      'X-Device-Name': 'Thieez Website'
    }
  });
  if (!response.ok) throw new Error(`Authentication failed with ${response.status}`);
  const payload = (await response.json()) as { user?: AuthUser } & AuthUser;
  return payload.user ?? payload;
}

async function refreshSession(session: AuthSession): Promise<AuthSession | null> {
  if (!session.refreshToken) return null;
  const response = await fetch(`${AUTH_BASE}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: session.refreshToken,
      device_id: getDeviceId()
    })
  });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
  };
  return {
    ...session,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000
  };
}

/** Starts the same Google OAuth flow used by the Obsidian plugin. */
export function startLogin(): void {
  if (!isBrowser()) return;
  const returnUrl = `${window.location.origin}${window.location.pathname}`;
  window.location.assign(`${AUTH_BASE}/login?redirect_to=${encodeURIComponent(returnUrl)}`);
}

/** Reads OAuth callback parameters, stores the session, and cleans the URL. */
export async function restoreAuth(): Promise<AuthSession | null> {
  if (!isBrowser()) return null;

  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const expiresIn = Number(params.get('expires_in') ?? 3600);
  let session = readSession();

  if (accessToken) {
    session = {
      accessToken,
      refreshToken: refreshToken ?? '',
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
      user: null
    };
    writeSession(session);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  if (!session) return null;
  if (session.expiresAt <= Date.now() + 60_000) {
    session = await refreshSession(session);
    if (!session) {
      writeSession(null);
      return null;
    }
  }

  try {
    session.user = await fetchUser(session.accessToken);
    writeSession(session);
    return session;
  } catch {
    writeSession(null);
    return null;
  }
}

export async function logout(session: AuthSession | null): Promise<void> {
  if (session?.accessToken) {
    await fetch(`${AUTH_BASE}/logout`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    }).catch(() => undefined);
  }
  writeSession(null);
}

type Release = {
  tag_name?: string;
  published_at?: string;
  assets?: ApiAsset[];
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    const error = new Error(`API responded with ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
}

export async function getProjects(): Promise<ProjectResult> {
  try {
    const payload = await fetchJson<Project[] | { projects?: Project[] }>('/projects/v0');
    const projects = Array.isArray(payload) ? payload : payload.projects ?? [];
    return { projects, source: 'api' };
  } catch (cause) {
    const status = cause instanceof Error ? (cause as Error & { status?: number }).status : undefined;
    if (status !== 404 && status !== 405) throw cause;
    return { projects: [], source: 'fallback' };
  }
}

function resolveAssetUrl(value?: string): string | undefined {
  if (!value) return undefined;
  return new URL(value, `${API_BASE}/`).toString();
}

export async function getLatestBuild(): Promise<LatestBuild> {
  try {
    const latest = await fetchJson<LatestBuild>('/updates/v0/latest');
    return { ...latest, assets: latest.assets ?? [] };
  } catch {
    const releases = await fetchJson<Release[]>('/lisnnto/v0/builds');
    const latest = releases[0] ?? {};
    return { ...latest, assets: latest.assets ?? [] };
  }
}

export async function getLatestPluginBuild(): Promise<PluginBuild> {
  try {
    const latest = await fetchJson<PluginBuild>('/updates/v0/repository/Thieez/note/latest');
    return { ...latest, assets: latest.assets ?? [] };
  } catch (cause) {
    const status = cause instanceof Error ? (cause as Error & { status?: number }).status : undefined;
    if (status === 404) return { assets: [] };
    throw cause;
  }
}

export function getPluginZipAsset(build: PluginBuild): ApiAsset | undefined {
  const asset = build.assets.find((candidate) => candidate.name.toLowerCase().endsWith('.zip'));
  if (!asset) return undefined;
  return {
    ...asset,
    browser_download_url: resolveAssetUrl(asset.browser_download_url),
    download_url: resolveAssetUrl(asset.download_url)
  };
}

export function getApkAsset(build: LatestBuild): ApiAsset | undefined {
  const asset = build.assets.find((candidate) => candidate.name.toLowerCase().endsWith('.apk'));
  if (!asset) return undefined;
  return {
    ...asset,
    browser_download_url: resolveAssetUrl(asset.browser_download_url),
    download_url: resolveAssetUrl(asset.download_url)
  };
}

export function formatReleaseDate(value?: string): string {
  if (!value) return 'Date not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}
