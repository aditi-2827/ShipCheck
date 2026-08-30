import { errorResponse, okResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return okResponse({ authenticated: true });
  } catch (err) {
    return errorResponse(err);
  }
}
