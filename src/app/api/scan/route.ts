import { errorResponse, okResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth';
import { runScan } from '@/lib/checks';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

export async function POST() {
  try {
    requireAuth();
    const result = await runScan();
    return okResponse(result, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
