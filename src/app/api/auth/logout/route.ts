import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/http';
import { destroySession, expireSessionCookie, getSessionToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const token = getSessionToken();
    if (token) {
      await destroySession(token);
    }
    const res = NextResponse.json({ ok: true, data: { authenticated: false } });
    res.headers.set('Set-Cookie', expireSessionCookie());
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
