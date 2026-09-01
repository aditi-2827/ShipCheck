import { errorResponse, okResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth';
import { getHistory, getHistoryByProject } from '@/lib/store';
import type { ScanResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    requireAuth(req);
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const history = projectId ? getHistoryByProject(projectId) : getHistory<ScanResult>();
    return okResponse(history);
  } catch (err) {
    return errorResponse(err);
  }
}
