import type { FeedData, ScanResult } from '@/lib/types';

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

// Invoked on any 401 UNAUTHORIZED response so the app can redirect to /login.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
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
    if (res.status === 401 || code === 'UNAUTHORIZED') {
      unauthorizedHandler?.();
    }
    throw new ClientApiError(res.status, code, message);
  }

  if (body.data === undefined) {
    throw new ClientApiError(res.status, 'BAD_RESPONSE', 'Response is missing data payload');
  }

  return body.data;
}

export async function getMe(): Promise<{ authenticated: boolean }> {
  return request<{ authenticated: boolean }>('/api/auth/me');
}

export async function login(password: string): Promise<{ authenticated: boolean }> {
  return request<{ authenticated: boolean }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function logout(): Promise<{ authenticated: boolean }> {
  return request<{ authenticated: boolean }>('/api/auth/logout', { method: 'POST' });
}

export async function getFeed(): Promise<FeedData> {
  return request<FeedData>('/api/feed');
}

export async function runScan(): Promise<ScanResult> {
  return request<ScanResult>('/api/scan', { method: 'POST' });
}

export async function getHistory(): Promise<ScanResult[]> {
  return request<ScanResult[]>('/api/history');
}
