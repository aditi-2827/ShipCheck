import { FEED_DATA } from '@/lib/data';
import { errorResponse, okResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return okResponse(FEED_DATA);
  } catch (err) {
    return errorResponse(err);
  }
}
