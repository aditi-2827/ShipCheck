import fs from 'node:fs';
import path from 'node:path';
import { ApiError, errorResponse, okResponse, readJson } from '@/lib/http';
import { requireAuth } from '@/lib/auth';
import { runScan } from '@/lib/checks';
import { getProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

export async function POST(req: Request) {
  try {
    let projectId: string | undefined;
    let targetDir: string = process.cwd();

    let body: Record<string, unknown> | undefined;
    try {
      body = await readJson(req);
    } catch {
      // Body may be empty on default scans from web UI
    }

    if (body && typeof body.projectId === 'string' && body.projectId.trim()) {
      const pId = body.projectId.trim();
      const project = getProject(pId);
      if (!project) {
        throw new ApiError('NOT_FOUND', `Project with ID ${pId} not found`, 404);
      }
      projectId = pId;
    }

    if (body && typeof body.targetDir === 'string' && body.targetDir.trim()) {
      const trimmedDir = body.targetDir.trim();
      if (!path.isAbsolute(trimmedDir)) {
        throw new ApiError('BAD_REQUEST', 'targetDir must be an absolute path', 400);
      }
      if (!fs.existsSync(trimmedDir)) {
        throw new ApiError('BAD_REQUEST', `Directory does not exist: ${trimmedDir}`, 400);
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(trimmedDir);
      } catch {
        throw new ApiError('BAD_REQUEST', `Could not inspect target directory: ${trimmedDir}`, 400);
      }
      if (!stat.isDirectory()) {
        throw new ApiError('BAD_REQUEST', `targetDir is not a directory: ${trimmedDir}`, 400);
      }
      targetDir = trimmedDir;
    }

    const result = await runScan(targetDir, projectId);
    return okResponse(result, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
