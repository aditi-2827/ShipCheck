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

export async function runScan(): Promise<ScanResult> {
  return request<ScanResult>('/api/scan', { method: 'POST' });
}

export async function getHistory(): Promise<ScanResult[]> {
  return request<ScanResult[]>('/api/history');
}
