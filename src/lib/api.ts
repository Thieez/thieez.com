export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, '') || 'https://api.thieez.com';
export const AUTH_BASE = `${API_BASE}/auth/v0`;

const REQUEST_TIMEOUT_MS = 15_000;

export type AuthUser = {
  id?: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  is_admin?: boolean;
  [key: string]: unknown;
};

export type LisnntoLimits = {
  tracks_count: number;
  tracks_limit: number;
  playlists_count: number;
  playlists_limit: number;
  database_size_bytes?: number;
  database_quota_bytes?: number;
  database_usage_ratio?: number;
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

export type DatabaseStorage = {
  used_bytes: number;
  available_bytes: number;
  quota_bytes: number;
  usage_ratio: number;
};

export type ApiHeartbeatConnection = 'connecting' | 'connected' | 'disconnected';

export type RenderMetricSeries = {
  labels?: Array<{ field?: string; value?: string }>;
  unit?: string;
  values?: Array<{ timestamp?: string; value?: number }>;
};

export type RenderLimits = {
  service_name: string;
  service_type?: string;
  plan: string;
  region?: string;
  instance_count?: number;
  limits: {
    cpu_cores?: number | null;
    memory_mb?: number | null;
    disk_gb?: number | null;
  };
  status?: string;
  runtime?: string;
  build_plan?: string;
  auto_deploy?: string | boolean;
  url?: string;
  health_check_path?: string;
  updated_at?: string;
  created_at?: string;
  disk: {
    size_gb?: number;
    mount_path?: string;
    name?: string;
  };
  metrics?: Record<string, { value: number; timestamp?: string; unit?: string } | null>;
  metric_series?: Record<string, RenderMetricSeries[]>;
  metrics_window?: {
    start: string;
    end: string;
    resolution_seconds: number;
  };
  metric_errors?: Record<string, string>;
  latest_deploy?: {
    id?: string;
    status?: string;
    createdAt?: string;
    finishedAt?: string;
    commit?: { id?: string; message?: string };
  } | null;
  instances: Array<{
    id?: string;
    createdAt?: string;
  }>;
  render_data?: Record<string, unknown>;
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

type Release = {
  tag_name?: string;
  published_at?: string;
  assets?: ApiAsset[];
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    const error = new Error(`API responded with ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
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

export async function getDatabaseStorage(): Promise<DatabaseStorage> {
  return fetchJson<DatabaseStorage>('/lisnnto/v0/storage');
}

export async function getRenderLimits(): Promise<RenderLimits> {
  try {
    return await fetchJson<RenderLimits>('/render/v0/limits');
  } catch (cause) {
    const status = cause instanceof Error ? (cause as Error & { status?: number }).status : undefined;
    if (status !== 404 && status !== 405) throw cause;
    return fetchJson<RenderLimits>('/render/limits');
  }
}

export function subscribeToProjectUpdates(onUpdate: () => void): () => void {
  if (!isBrowser()) return () => undefined;

  const websocketBase = API_BASE.replace(/^http/, 'ws');
  const socket = new WebSocket(`${websocketBase}/projects/v0/updates`);
  const handleMessage = (event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as { type?: string };
      if (message.type === 'projects') onUpdate();
    } catch {
      // Ignore non-JSON keepalive messages.
    }
  };
  socket.addEventListener('message', handleMessage);

  return () => {
    socket.removeEventListener('message', handleMessage);
    socket.close();
  };
}

export function subscribeToApiHeartbeat(
  onConnectionChange: (connection: ApiHeartbeatConnection) => void
): () => void {
  if (!isBrowser()) return () => undefined;

  let stopped = false;
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let heartbeatTimer: number | undefined;
  let reconnectDelay = 1000;
  let connection: ApiHeartbeatConnection = 'connecting';

  const setConnection = (next: ApiHeartbeatConnection) => {
    if (connection === next) return;
    connection = next;
    onConnectionChange(next);
  };

  const connect = () => {
    if (stopped) return;
    setConnection('connecting');

    const stopHeartbeatTimeout = () => {
      if (heartbeatTimer !== undefined) {
        window.clearTimeout(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer !== undefined) return;
      setConnection('disconnected');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        setConnection('connecting');
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
    };

    let currentSocket: WebSocket;
    try {
      currentSocket = new WebSocket(
        `${API_BASE.replace(/^http/, 'ws')}/uptime/v0/heartbeat`
      );
    } catch {
      scheduleReconnect();
      return;
    }
    socket = currentSocket;

    const startHeartbeatTimeout = () => {
      stopHeartbeatTimeout();
      heartbeatTimer = window.setTimeout(() => currentSocket.close(), 5000);
    };

    currentSocket.addEventListener('open', () => {
      if (socket !== currentSocket || stopped) return;
      reconnectDelay = 1000;
      startHeartbeatTimeout();
    });
    currentSocket.addEventListener('message', (event: MessageEvent<string>) => {
      if (socket !== currentSocket || stopped) return;
      try {
        const message = JSON.parse(event.data) as { type?: string; timestamp?: string };
        if (message.type !== 'heartbeat') return;
        if (typeof message.timestamp !== 'string' || Number.isNaN(Date.parse(message.timestamp))) return;
        setConnection('connected');
        startHeartbeatTimeout();
      } catch {
        // Ignore malformed messages; the heartbeat timeout will mark the connection unavailable.
      }
    });
    currentSocket.addEventListener('close', () => {
      if (socket !== currentSocket || stopped) return;
      stopHeartbeatTimeout();
      scheduleReconnect();
    });
    currentSocket.addEventListener('error', () => currentSocket.close());
    startHeartbeatTimeout();
  };

  connect();
  return () => {
    stopped = true;
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    if (heartbeatTimer !== undefined) window.clearTimeout(heartbeatTimer);
    socket?.close();
  };
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
