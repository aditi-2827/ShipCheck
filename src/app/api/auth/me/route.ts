import { errorResponse, okResponse } from '@/lib/http';
import { getAuthToken, tokenIsValid } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const authenticated = tokenIsValid(getAuthToken(req));
    return okResponse({ authenticated });
  } catch (err) {
    return errorResponse(err);
  }
}