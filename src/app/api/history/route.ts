import { errorResponse, okResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth';
import { getHistory } from '@/lib/store';
import type { ScanResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    requireAuth();
    const history = getHistory<ScanResult>();
    return okResponse(history);
  } catch (err) {
    return errorResponse(err);
  }
}
