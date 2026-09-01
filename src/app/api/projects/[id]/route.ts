import { ApiError, errorResponse, okResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth';
import { getProject, getHistoryByProject } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    requireAuth(req);
    const project = getProject(params.id);
    if (!project) {
      throw new ApiError('NOT_FOUND', `Project with ID ${params.id} not found`, 404);
    }
    const history = getHistoryByProject(params.id);
    return okResponse({
      project,
      history,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
