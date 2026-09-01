import type { FeedData, Project, ScanResult } from '@/lib/types';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

// Thrown for any non-OK API response, carrying the HTTP status and error code.
export class ClientApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ClientApiError';
  }
}

// Bearer token captured from the dashboard link (?token=...) printed by the CLI.
// Sent as x-shipcheck-token on every request so routing stays shareable and the
// link keeps working under `next start`.
let authToken: string | null = null;

export function getBearerToken(): string | null {
  return authToken;
}

// Called once on app mount (and by the project dashboard): reads `?token=` from
// the current URL, stores it, then strips it out of the address bar without a
// reload so it is not left in history after the first request.
export function initAuth(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    authToken = token;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore URL rewriting failures
    }
  }
  return authToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (authToken) {
    headers['x-shipcheck-token'] = authToken;
  }

  const res = await fetch(path, {
    headers,
    credentials: 'same-origin',
    ...init,
  });

  let body: { ok: boolean; data?: T; error?: ApiErrorBody };
  try {
    body = (await res.json()) as { ok: boolean; data?: T; error?: ApiErrorBody };
  } catch {
    throw new ClientApiError(res.status, 'BAD_RESPONSE', 'Server returned an unreadable response');
  }

  if (!res.ok || !body.ok) {
    const code = body.error?.code ?? 'INTERNAL';
    const message = body.error?.message ?? `Request failed with status ${res.status}`;
    throw new ClientApiError(res.status, code, message);
  }

  if (body.data === undefined) {
    throw new ClientApiError(res.status, 'BAD_RESPONSE', 'Response is missing data payload');
  }

  return body.data;
}

export async function getFeed(): Promise<FeedData> {
  return request<FeedData>('/api/feed');
}

export async function runScan(projectId?: string, targetDir?: string): Promise<ScanResult> {
  const body: Record<string, string> = {};
  if (projectId) body.projectId = projectId;
  if (targetDir) body.targetDir = targetDir;
  return request<ScanResult>('/api/scan', {
    method: 'POST',
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  });
}

export async function getHistory(projectId?: string): Promise<ScanResult[]> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return request<ScanResult[]>(`/api/history${qs}`);
}

export async function getProject(id: string): Promise<{ project: Project; history: ScanResult[] }> {
  return request<{ project: Project; history: ScanResult[] }>(`/api/projects/${encodeURIComponent(id)}`);
}

export async function getMe(): Promise<{ authenticated: boolean }> {
  return request<{ authenticated: boolean }>('/api/auth/me');
}