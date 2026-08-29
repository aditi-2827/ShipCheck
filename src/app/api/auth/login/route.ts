import { NextResponse } from 'next/server';
import { ApiError, errorResponse, readJson } from '@/lib/http';
import {
  createSession,
  isPasswordConfigured,
  sessionCookieValue,
  verifyPassword,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!isPasswordConfigured()) {
      throw new ApiError('INTERNAL', 'SHIPCHECK_PASSWORD is not configured on the server', 500);
    }
    if (!password) {
      throw new ApiError('BAD_REQUEST', 'password is required', 400);
    }
    if (!verifyPassword(password)) {
      throw new ApiError('UNAUTHORIZED', 'Invalid password', 401);
    }

    const token = await createSession();
    const res = NextResponse.json({ ok: true, data: { authenticated: true } });
    res.headers.set('Set-Cookie', sessionCookieValue(token));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
