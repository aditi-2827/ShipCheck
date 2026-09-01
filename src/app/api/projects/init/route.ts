import { ApiError, errorResponse, okResponse, readJson } from '@/lib/http';
import { requireAuth } from '@/lib/auth';
import { createProject } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    requireAuth(req);
    const body = await readJson(req);
    const rawName = body.name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name) {
      throw new ApiError('BAD_REQUEST', 'Project name is required', 400);
    }
    const project = createProject(name);
    const origin = req.headers.get('origin') ?? req.headers.get('host') ?? 'http://localhost:3140';
    const baseUrl = origin.startsWith('http') ? origin : `http://${origin}`;
    const dashboardUrl = `${baseUrl}/project/${project.id}`;

    return okResponse(
      {
        id: project.id,
        name: project.name,
        dashboardUrl,
      },
      201,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
