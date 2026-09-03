import { ApiError, errorResponse, okResponse, readJson } from '@/lib/http';
import { requireAuth } from '@/lib/auth';
import { getProject, getHistoryByProject, setProjectDeployUrl } from '@/lib/store';

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

// Update settings for a project (currently just the deploy URL used to enable
// Phase 3 API/Post-Deploy/Performance checks).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    requireAuth(req);
    const project = getProject(params.id);
    if (!project) {
      throw new ApiError('NOT_FOUND', `Project with ID ${params.id} not found`, 404);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await readJson(req);
    } catch {
      throw new ApiError('BAD_REQUEST', 'Invalid JSON body', 400);
    }

    const rawDeployUrl = typeof body.deployUrl === 'string' ? body.deployUrl : undefined;
    const deployUrl = rawDeployUrl?.trim() ? rawDeployUrl.trim() : undefined;

    const updated = setProjectDeployUrl(params.id, deployUrl);
    return okResponse({ project: updated }, 200);
  } catch (err) {
    return errorResponse(err);
  }
}
