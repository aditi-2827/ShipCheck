import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CategoryResult, CheckSummary, Issue, ScanComparison, ScanResult } from './types';
import { appendHistory, getHistoryByProject, touchProject } from './store';
import { FEED_DATA } from './data';
import { ApiError } from './http';

const SERVER_ROOT = process.cwd();

// Overall cap for the whole scan (per-command timeouts still apply individually).
const SCAN_GLOBAL_DEADLINE_MS = 600_000; // 10 minutes

// Only one scan may execute at a time (single-flight).
let activeScan = false;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

// npm's own JS entry, so we can spawn npm via the node binary directly and
// avoid `cmd.exe`/shell entirely (safe argument-array execution on Windows too).
function resolveNpmCli(): string | null {
  const candidates: string[] = [];
  if (process.env.npm_execpath && /npm-cli\.js$/.test(process.env.npm_execpath)) {
    candidates.push(process.env.npm_execpath);
  }
  const nodeDir = path.dirname(process.execPath);
  candidates.push(path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  candidates.push(path.join(process.execPath, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function planSpawn(args: string[]): { file: string; cmdArgs: string[] } {
  const [program, ...rest] = args;
  if (program === 'npm') {
    const npmCli = resolveNpmCli();
    if (npmCli) {
      return { file: process.execPath, cmdArgs: [npmCli, ...rest] };
    }
    return { file: 'npm', cmdArgs: rest };
  }
  if (program === 'node') {
    return { file: process.execPath, cmdArgs: rest };
  }
  return { file: program, cmdArgs: rest };
}

function runCommand(
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; signal?: AbortSignal } = {},
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return new Promise((resolve) => {
    const planned = planSpawn(args);
    execFile(
      planned.file,
      planned.cmdArgs,
      {
        cwd: opts.cwd ?? SERVER_ROOT,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          const err = error as NodeJS.ErrnoException & {
            code?: number | string;
            signal?: string | null;
            killed?: boolean;
          };
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode: typeof err.code === 'number' ? err.code : null,
            signal: err.signal ?? null,
            timedOut: err.killed === true || opts.signal?.aborted === true,
          });
          return;
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0, signal: null, timedOut: false });
      },
    );
  });
}

function fileExists(targetDir: string, rel: string): boolean {
  return fs.existsSync(path.join(targetDir, rel));
}

interface TempWorkspace {
  dir: string;
}

// Everything that must reach the isolated build/test workspace.
const WS_EXCLUDE_DIRS = new Set(['node_modules', '.next', '.git', '.data', 'dist', 'build', '__pycache__']);

function copyTreeFull(src: string, dest: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.env')) continue; // never copy any environment file/secret
    if (WS_EXCLUDE_DIRS.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTreeFull(from, to);
    } else {
      try {
        fs.copyFileSync(from, to);
      } catch {
        // Skip unreadable/unsupported files rather than failing the whole scan.
      }
    }
  }
}

function createTempWorkspace(targetDir: string): TempWorkspace {
  const base = path.join(SERVER_ROOT, '.data', 'tmp');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'scan-'));
  copyTreeFull(targetDir, dir);

  // Reuse the installed dependencies through a Windows directory junction.
  const realNodeModules = path.join(targetDir, 'node_modules');
  const wsNodeModules = path.join(dir, 'node_modules');
  if (fs.existsSync(realNodeModules)) {
    try {
      fs.symlinkSync(realNodeModules, wsNodeModules, 'junction');
    } catch {
      throw new Error(
        `Failed to create node_modules junction for the isolated scan workspace (${realNodeModules}). ` +
          'Cannot run the build/test checks without it.',
      );
    }
  }

  return { dir };
}

function destroyTempWorkspace(ws: TempWorkspace | null): void {
  if (!ws) return;
  try {
    const base = path.dirname(ws.dir);
    if (path.basename(ws.dir).startsWith('scan-') && base.endsWith(path.join('.data', 'tmp'))) {
      fs.rmSync(ws.dir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup
  }
}

async function withTempWorkspace<T>(targetDir: string, fn: (ws: TempWorkspace) => Promise<T>): Promise<T> {
  const ws = createTempWorkspace(targetDir);
  try {
    return await fn(ws);
  } finally {
    destroyTempWorkspace(ws);
  }
}

function runCommandIn(
  args: string[],
  cwd: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return new Promise((resolve) => {
    const planned = planSpawn(args);
    execFile(
      planned.file,
      planned.cmdArgs,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          const err = error as NodeJS.ErrnoException & {
            code?: number | string;
            signal?: string | null;
            killed?: boolean;
          };
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode: typeof err.code === 'number' ? err.code : null,
            signal: err.signal ?? null,
            timedOut: err.killed === true || opts.signal?.aborted === true,
          });
          return;
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0, signal: null, timedOut: false });
      },
    );
  });
}

function isCleanGitStatus(stdout: string): boolean {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0 && !l.trim().startsWith('?? '));
  const untracked = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('?? '));
  return lines.length === 0 && untracked.length === 0;
}

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'generic API key assignment', pattern: /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i },
];

function scanForSecrets(targetDir: string): Issue[] {
  const found: Issue[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (WS_EXCLUDE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|rb|php|go|rs|env|json|ya?ml|toml|ini|env\.example)$/.test(entry.name)) {
        let content: string;
        try {
          content = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        const rel = path.relative(targetDir, full);
        for (const p of SECRET_PATTERNS) {
          const match = content.match(p.pattern);
          if (match && match.index !== undefined) {
            const line = content.slice(0, match.index).split(/\r?\n/).length;
            found.push({
              severity: 'critical',
              title: `Possible ${p.name} in source`,
              file: rel,
              line,
              message: `A pattern matching "${p.name}" was found in a source file.`,
              fix: 'Remove the secret, move it to an environment variable, and ensure it is excluded from Git tracking.',
            });
            break;
          }
        }
      }
    }
  };
  walk(targetDir);
  return found;
}

function envExampleCheck(targetDir: string): Issue[] {
  const issues: Issue[] = [];
  if (!fileExists(targetDir, '.env.example')) {
    issues.push({
      severity: 'warning',
      title: '.env.example is missing',
      file: '.env.example',
      line: null,
      message: 'The repository does not ship an environment template.',
      fix: 'Create a .env.example documenting all required environment variables.',
    });
  }
  return issues;
}

function packageJsonScript(targetDir: string, name: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return Boolean(pkg.scripts && typeof pkg.scripts[name] === 'string' && pkg.scripts[name].length > 0);
  } catch {
    return false;
  }
}

function packageJsonTestScript(targetDir: string): boolean {
  return packageJsonScript(targetDir, 'test');
}

function packageJsonBuildScript(targetDir: string): boolean {
  return packageJsonScript(targetDir, 'build');
}

interface CategoryInput {
  slug: string;
  name: string;
  checks: CheckSummary[];
  issues: Issue[];
}

function toCategory(input: CategoryInput): CategoryResult {
  const passed = input.checks.filter((c) => c.status === 'pass').length;
  const total = input.checks.length;
  return {
    slug: input.slug,
    name: input.name,
    status: input.issues.some((i) => i.severity === 'critical') ? 'critical' : input.issues.length > 0 ? 'warning' : 'pass',
    score: `${passed}/${total}`,
    childChecks: input.checks,
  };
}

// Per-category weighted ship score (0-100). Each category contributes up to its
// weight when healthy; a warning keeps half of its weight, a critical category
// contributes nothing. Unknown categories fall back to the remaining weight
// split evenly.
function computeScore(categories: CategoryResult[]): number {
  const weights = FEED_DATA.categoryWeights;
  const knownWeight = categories.reduce((sum, c) => sum + (weights[c.slug] ?? 0), 0);
  const leftover = Math.max(0, 100 - knownWeight);
  const unknownCategories = categories.filter((c) => weights[c.slug] === undefined);
  const perUnknown = leftover / Math.max(1, unknownCategories.length);

  let score = 0;
  for (const cat of categories) {
    const base = weights[cat.slug] ?? perUnknown;
    if (cat.status === 'pass') {
      score += base;
    } else if (cat.status === 'warning') {
      score += base / 2;
    }
    // critical -> 0
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function runScan(targetDir: string = process.cwd(), projectId?: string): Promise<ScanResult> {
  if (activeScan) {
    throw new ApiError('CONFLICT', 'A scan is already running. Wait for it to finish.', 409);
  }
  activeScan = true;
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), SCAN_GLOBAL_DEADLINE_MS);
  try {
    const result = await scanBody(targetDir, projectId, controller.signal);
    if (controller.signal.aborted) {
      throw new ApiError('SCAN_FAILED', 'Scan exceeded the global time limit', 503);
    }

    if (projectId) {
      const past = getHistoryByProject(projectId);
      const previousScan = past[0] ?? null;
      if (previousScan) {
        const scoreDelta = result.score - previousScan.score;
        const resolvedIssues = previousScan.issues.filter(
          (p) => !result.issues.some((c) => c.title === p.title && c.file === p.file),
        );
        const introducedIssues = result.issues.filter(
          (c) => !previousScan.issues.some((p) => p.title === c.title && p.file === c.file),
        );
        const comparison: ScanComparison = {
          previousScore: previousScan.score,
          scoreDelta,
          resolvedIssues,
          introducedIssues,
        };
        result.comparison = comparison;
      }
      touchProject(projectId);
    }

    void appendHistory(result);
    return result;
  } finally {
    clearTimeout(deadlineTimer);
    activeScan = false;
  }
}

async function scanBody(targetDir: string, projectId: string | undefined, signal: AbortSignal): Promise<ScanResult> {
  const started = Date.now();

  // --- Environment ---
  const nodeRes = await runCommand(['node', '--version'], { timeoutMs: 10_000, signal, cwd: targetDir });
  const npmRes = await runCommand(['npm', '--version'], { timeoutMs: 10_000, signal, cwd: targetDir });
  const envChecks: CheckSummary[] = [
    {
      slug: 'node',
      name: 'Node',
      status: nodeRes.exitCode === 0 ? 'pass' : 'critical',
      detail: nodeRes.exitCode === 0 ? nodeRes.stdout.trim() : 'Node runtime not available',
    },
    {
      slug: 'npm',
      name: 'npm',
      status: npmRes.exitCode === 0 ? 'pass' : 'critical',
      detail: npmRes.exitCode === 0 ? npmRes.stdout.trim() : 'npm not available',
    },
  ];

  // --- Git ---
  const branchRes = await runCommand(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 10_000, signal, cwd: targetDir });
  const statusRes = await runCommand(['git', 'status', '--porcelain'], { timeoutMs: 10_000, signal, cwd: targetDir });
  const commitRes = await runCommand(['git', 'rev-parse', '--short', 'HEAD'], { timeoutMs: 10_000, signal, cwd: targetDir });
  const clean = statusRes.exitCode === 0 && isCleanGitStatus(statusRes.stdout);
  const gitIssues: Issue[] = [];
  if (!clean) {
    gitIssues.push({
      severity: 'warning',
      title: 'Uncommitted changes detected',
      file: 'git status',
      line: null,
      message: 'There are local working-tree changes that have not been committed.',
      fix: 'Review, commit, or intentionally exclude the modified files before deployment.',
    });
  }
  const gitChecks: CheckSummary[] = [
    {
      slug: 'branch',
      name: 'Branch',
      status: branchRes.exitCode === 0 ? 'pass' : 'critical',
      detail: branchRes.exitCode === 0 ? branchRes.stdout.trim() : 'Not a git repository',
    },
    {
      slug: 'working-tree',
      name: 'Working tree',
      status: clean ? 'pass' : 'warning',
      detail: clean
        ? 'Working tree is clean'
        : `${(statusRes.stdout || '').split(/\r?\n/).filter((l) => l.trim()).length} path(s) modified/untracked`,
    },
  ];

  // --- Dependencies / Build / Tests ---
  const { auditIssues, depSummary, depStatus, buildIssues, buildStatus, buildSummary, testIssues, testStatus, testSummary } =
    await withTempWorkspace(targetDir, async (ws) => {
      const auditIssues: Issue[] = [];
      let depSummary = 'not run';
      let depStatus: CheckSummary['status'] = 'pass';
      if (fileExists(targetDir, 'package-lock.json') || fileExists(targetDir, 'package.json')) {
        const auditRes = await runCommandIn(['npm', 'audit', '--audit-level=high', '--json'], ws.dir, {
          timeoutMs: 60_000,
          signal,
        });
        if (auditRes.exitCode === 0) {
          depStatus = 'pass';
          depSummary = 'No high/critical vulnerabilities found';
        } else {
          depStatus = 'warning';
          depSummary = 'High or critical vulnerabilities reported by npm audit';
          auditIssues.push({
            severity: 'warning',
            title: 'Dependency vulnerabilities',
            file: 'package.json',
            line: null,
            message: 'npm audit reported issues at or above the high severity threshold.',
            fix: 'Run `npm audit fix` and review the report.',
          });
        }
      } else {
        depSummary = 'No package manifest detected';
      }

      const buildIssues: Issue[] = [];
      let buildStatus: CheckSummary['status'] = 'pass';
      let buildSummary = 'Build valid';
      if (fileExists(targetDir, 'package.json')) {
        if (!packageJsonBuildScript(targetDir)) {
          buildStatus = 'warning';
          buildSummary = 'No build script configured';
          buildIssues.push({
            severity: 'warning',
            title: 'No build script configured',
            file: 'package.json',
            line: null,
            message: 'There is no "build" script in package.json, so no production build could be run.',
            fix: 'Add a "build" script to package.json if this package should produce a deployable build.',
          });
        } else {
          const buildRes = await runCommandIn(['npm', 'run', 'build'], ws.dir, { timeoutMs: 180_000, signal });
          if (buildRes.exitCode === 0) {
            buildStatus = 'pass';
            buildSummary = buildRes.timedOut ? 'Build timed out' : 'Build completed successfully';
            if (buildRes.timedOut) buildStatus = 'warning';
          } else {
            buildStatus = 'critical';
            buildSummary = `Build failed (exit ${buildRes.exitCode ?? 'n/a'})`;
            const lastLines = (buildRes.stderr || buildRes.stdout || '')
              .split(/\r?\n/)
              .filter((l) => l.trim())
              .slice(-5)
              .join(' ');
            buildIssues.push({
              severity: 'critical',
              title: 'Production build failed',
              file: null,
              line: null,
              message: `npm run build did not complete successfully. ${lastLines}`,
              fix: 'Fix the build errors reported by the bundler/compiler.',
            });
          }
        }
      } else {
        buildStatus = 'warning';
        buildSummary = 'No package.json to build';
      }

      const testIssues: Issue[] = [];
      let testStatus: CheckSummary['status'] = 'pass';
      let testSummary = 'No test suite configured';
      if (packageJsonTestScript(targetDir)) {
        const testRes = await runCommandIn(['npm', 'test'], ws.dir, { timeoutMs: 180_000, signal });
        if (testRes.exitCode === 0) {
          testStatus = 'pass';
          testSummary = 'Tests passed';
        } else {
          testStatus = 'critical';
          testSummary = `Tests failed (exit ${testRes.exitCode ?? 'n/a'})`;
          const lastLines = (testRes.stderr || testRes.stdout || '')
            .split(/\r?\n/)
            .filter((l) => l.trim())
            .slice(-5)
            .join(' ');
          testIssues.push({
            severity: 'critical',
            title: 'Test suite failed',
            file: null,
            line: null,
            message: `npm test did not pass. ${lastLines}`,
            fix: 'Fix the failing tests before shipping.',
          });
        }
      } else {
        testStatus = 'warning';
        testIssues.push({
          severity: 'warning',
          title: 'No test script configured',
          file: 'package.json',
          line: null,
          message: 'There is no "test" script in package.json, so tests could not be run.',
          fix: 'Add a test runner and a "test" script to package.json.',
        });
      }

      return { auditIssues, depSummary, depStatus, buildIssues, buildStatus, buildSummary, testIssues, testStatus, testSummary };
    });

  const depChecks: CheckSummary[] = [
    { slug: 'audit', name: 'npm audit', status: depStatus, detail: depSummary },
  ];
  const buildChecks: CheckSummary[] = [
    { slug: 'build', name: 'npm run build', status: buildStatus, detail: buildSummary },
  ];
  const testChecks: CheckSummary[] = [
    { slug: 'tests', name: 'Test suite', status: testStatus, detail: testSummary },
  ];

  // --- Docker ---
  const dockerIssues: Issue[] = [];
  let dockerStatus: CheckSummary['status'] = 'pass';
  let dockerSummary = 'No Dockerfile detected';
  if (fileExists(targetDir, 'Dockerfile') || fileExists(targetDir, 'docker-compose.yml') || fileExists(targetDir, 'compose.yaml')) {
    dockerStatus = 'pass';
    dockerSummary = 'Docker configuration present';
    if (fileExists(targetDir, 'Dockerfile')) {
      const df = fs.readFileSync(path.join(targetDir, 'Dockerfile'), 'utf8');
      if (!/^FROM\s+/im.test(df)) {
        dockerStatus = 'warning';
        dockerSummary = 'Dockerfile present but missing a base image (FROM)';
        dockerIssues.push({
          severity: 'warning',
          title: 'Dockerfile has no base image',
          file: 'Dockerfile',
          line: null,
          message: 'A Dockerfile without a FROM instruction is invalid.',
          fix: 'Specify a valid base image via FROM.',
        });
      }
    }
  }
  const dockerChecks: CheckSummary[] = [
    { slug: 'docker', name: 'Docker', status: dockerStatus, detail: dockerSummary },
  ];

  // --- Security ---
  const secretIssues = scanForSecrets(targetDir);
  const envIssues = envExampleCheck(targetDir);
  const securityIssues = [...secretIssues, ...envIssues];
  const secretFound = secretIssues.length > 0;
  const securityChecks: CheckSummary[] = [
    {
      slug: 'secrets',
      name: 'Secret scan',
      status: secretFound ? 'critical' : 'pass',
      detail: secretFound ? `${secretIssues.length} potential secret(s) found` : 'No secrets detected',
    },
    {
      slug: 'env-template',
      name: '.env.example',
      status: envIssues.length > 0 ? 'warning' : 'pass',
      detail: envIssues.length > 0 ? 'Required variables not declared' : 'Template complete',
    },
  ];

  const categories: CategoryResult[] = [
    toCategory({ slug: 'environment', name: 'Environment', checks: envChecks, issues: [] }),
    toCategory({ slug: 'git', name: 'Git', checks: gitChecks, issues: gitIssues }),
    toCategory({ slug: 'dependencies', name: 'Dependencies', checks: depChecks, issues: auditIssues }),
    toCategory({ slug: 'build', name: 'Build', checks: buildChecks, issues: buildIssues }),
    toCategory({ slug: 'tests', name: 'Tests', checks: testChecks, issues: testIssues }),
    toCategory({ slug: 'docker', name: 'Docker', checks: dockerChecks, issues: dockerIssues }),
    toCategory({ slug: 'security', name: 'Security', checks: securityChecks, issues: securityIssues }),
  ];

  const issues: Issue[] = [
    ...secretIssues,
    ...envIssues,
    ...buildIssues,
    ...testIssues,
    ...dockerIssues,
    ...gitIssues,
    ...auditIssues,
  ];

  const blockers = issues.filter((i) => i.severity === 'critical').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  const score = computeScore(categories);
  const status = score >= FEED_DATA.thresholds.ready ? 'READY' : score >= FEED_DATA.thresholds.warning ? 'WARNING' : 'BLOCKED';

  const result: ScanResult = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    ...(projectId ? { projectId } : {}),
    createdAt: new Date().toISOString(),
    score,
    status,
    categories,
    issues,
    checksRun: categories.reduce((sum, c) => sum + c.childChecks.length, 0),
    warnings,
    blockers,
    env: {
      node: envChecks[0].detail,
      npm: envChecks[1].detail,
      commit: commitRes.exitCode === 0 ? commitRes.stdout.trim() : 'n/a',
      branch: branchRes.exitCode === 0 ? branchRes.stdout.trim() : 'n/a',
      durationMs: Date.now() - started,
    },
  };

  return result;
}
