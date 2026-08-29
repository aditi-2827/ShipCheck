import { NextResponse } from 'next/server';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SCAN_FAILED'
  | 'CONFLICT'
  | 'INTERNAL';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    const body: ErrorBody = { ok: false, error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    return NextResponse.json(body, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return NextResponse.json({ ok: false, error: { code: 'INTERNAL', message } } satisfies ErrorBody, {
    status: 500,
  });
}

export function okResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError('BAD_REQUEST', 'Request body must be valid JSON', 400);
  }
  if (!isRecord(body)) {
    throw new ApiError('BAD_REQUEST', 'Request body must be a JSON object', 400);
  }
  return body;
}
