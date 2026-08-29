import { errorResponse, okResponse } from '@/lib/http';
import { getSessionToken, sessionIsValid } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const token = getSessionToken();
    const authenticated = Boolean(token) && sessionIsValid(token);
    return okResponse({ authenticated });
  } catch (err) {
    return errorResponse(err);
  }
}
