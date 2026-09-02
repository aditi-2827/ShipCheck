import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CategoryResult, CheckSummary, Issue, ScanComparison, ScanOptions, ScanResult } from './types';
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

export async function runScan(targetDir: string = process.cwd(), projectId?: string, options?: ScanOptions): Promise<ScanResult> {
  if (activeScan) {
    throw new ApiError('CONFLICT', 'A scan is already running. Wait for it to finish.', 409);
  }
  activeScan = true;
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), SCAN_GLOBAL_DEADLINE_MS);
  try {
    const result = await scanBody(targetDir, projectId, controller.signal, options);
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- deployUrl consumed by Phase 3 checks
async function scanBody(targetDir: string, projectId: string | undefined, signal: AbortSignal, _options?: ScanOptions): Promise<ScanResult> {
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

  // .gitignore validation
  const hasGitignore = fileExists(targetDir, '.gitignore');
  if (!hasGitignore) {
    gitIssues.push({
      severity: 'warning',
      title: 'No .gitignore file',
      file: '.gitignore',
      line: null,
      message: 'The repository has no .gitignore file. Sensitive files, build artifacts, and dependencies may be tracked.',
      fix: 'Create a .gitignore file listing files and directories that should not be version-controlled.',
    });
  } else {
    let gitignoreContent: string;
    try {
      gitignoreContent = fs.readFileSync(path.join(targetDir, '.gitignore'), 'utf8');
    } catch {
      gitignoreContent = '';
    }
    const missing: string[] = [];
    const required = ['node_modules', '.env', '.env.local', '.next'];
    for (const entry of required) {
      if (!gitignoreContent.includes(entry)) {
        missing.push(entry);
      }
    }
    if (missing.length > 0) {
      gitIssues.push({
        severity: 'warning',
        title: '.gitignore is missing critical entries',
        file: '.gitignore',
        line: null,
        message: `.gitignore does not exclude: ${missing.join(', ')}. These may be committed to the repository.`,
        fix: `Add ${missing.map((m) => `"${m}"`).join(', ')} to .gitignore.`,
      });
    }
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
    {
      slug: 'gitignore',
      name: '.gitignore',
      status: hasGitignore ? 'pass' : 'warning',
      detail: hasGitignore ? '.gitignore present' : 'No .gitignore file found',
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

  // --- Database ---
  const dbIssues: Issue[] = [];
  const dbChecks: CheckSummary[] = [];

  // Detect database framework from config files and dependencies
  const DB_FRAMEWORKS: { name: string; configFiles: string[]; depPatterns: RegExp[] }[] = [
    { name: 'Prisma', configFiles: ['prisma/schema.prisma', 'prisma/schema.ts'], depPatterns: [/@prisma\/client/] },
    { name: 'Drizzle', configFiles: ['drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.mjs'], depPatterns: [/drizzle-orm/, /drizzle-kit/] },
    { name: 'Knex', configFiles: ['knexfile.js', 'knexfile.ts', 'knexfile.cjs', 'knexfile.mjs'], depPatterns: [/knex/] },
    { name: 'Supabase', configFiles: ['supabase/config.toml'], depPatterns: [/@supabase\/supabase-js/] },
  ];
  const DB_DRIVERS: { name: string; depPatterns: RegExp[] }[] = [
    { name: 'PostgreSQL', depPatterns: [/\bpg\b/, /postgres/, /node-postgres/] },
    { name: 'MySQL', depPatterns: [/\bmysql2?\b/] },
    { name: 'MongoDB', depPatterns: [/\bmongodb\b/, /mongoose/] },
  ];

  let detectedDb: string | null = null;
  let hasDbConfig = false;

  // Check config files
  for (const fw of DB_FRAMEWORKS) {
    for (const cf of fw.configFiles) {
      if (fileExists(targetDir, cf)) {
        detectedDb = fw.name;
        hasDbConfig = true;
        break;
      }
    }
    if (hasDbConfig) break;
  }

  // Check package.json dependencies if config not found
  if (!hasDbConfig) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const fw of DB_FRAMEWORKS) {
        for (const dp of fw.depPatterns) {
          for (const dep of Object.keys(allDeps)) {
            if (dp.test(dep)) {
              detectedDb = fw.name;
              hasDbConfig = true;
              break;
            }
          }
          if (hasDbConfig) break;
        }
        if (hasDbConfig) break;
      }
    } catch {
      // No package.json or parse error
    }
  }

  // Detect raw drivers
  let detectedDriver: string | null = null;
  if (!detectedDb) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const dr of DB_DRIVERS) {
        for (const dp of dr.depPatterns) {
          for (const dep of Object.keys(allDeps)) {
            if (dp.test(dep)) {
              detectedDriver = dr.name;
              break;
            }
          }
          if (detectedDriver) break;
        }
        if (detectedDriver) break;
      }
    } catch {
      // No package.json
    }
  }

  const dbFramework = detectedDb ?? detectedDriver;
  if (dbFramework) {
    // Check for migration directory
    const migrationDirs = ['migrations', 'prisma/migrations', 'drizzle/migrations', 'db/migrate'];
    let hasMigrations = false;
    for (const md of migrationDirs) {
      if (fileExists(targetDir, md)) {
        hasMigrations = true;
        break;
      }
    }

    dbChecks.push({
      slug: 'db-framework',
      name: 'Database Framework',
      status: 'pass',
      detail: `${dbFramework} detected`,
    });
    dbChecks.push({
      slug: 'db-migrations',
      name: 'Migrations',
      status: hasMigrations ? 'pass' : 'warning',
      detail: hasMigrations ? 'Migration directory found' : 'No migration directory detected',
    });
    if (!hasMigrations) {
      dbIssues.push({
        severity: 'warning',
        title: 'No migration directory found',
        file: null,
        line: null,
        message: `${dbFramework} is configured but no migration directory was found.`,
        fix: 'Initialize a migrations directory for your database framework.',
      });
    }
  } else {
    dbChecks.push({
      slug: 'db-framework',
      name: 'Database Framework',
      status: 'pass',
      detail: 'No database framework detected',
    });
  }

  const databaseChecks: CheckSummary[] = dbChecks;

  // --- CI/CD ---
  const ciCdIssues: Issue[] = [];
  const CI_CONFIGS: { file: string; name: string }[] = [
    { file: '.github/workflows', name: 'GitHub Actions' },
    { file: '.gitlab-ci.yml', name: 'GitLab CI' },
    { file: '.gitlab-ci.yaml', name: 'GitLab CI' },
    { file: 'Jenkinsfile', name: 'Jenkins' },
    { file: '.circleci/config.yml', name: 'CircleCI' },
    { file: 'bitbucket-pipelines.yml', name: 'Bitbucket Pipelines' },
    { file: '.travis.yml', name: 'Travis CI' },
    { file: 'azure-pipelines.yml', name: 'Azure Pipelines' },
  ];

  let detectedCI: string | null = null;
  let ciConfigValid = true;

  for (const cfg of CI_CONFIGS) {
    if (cfg.file.endsWith('.yml') || cfg.file.endsWith('.yaml')) {
      if (fileExists(targetDir, cfg.file)) {
        detectedCI = cfg.name;
        // Basic YAML syntax check: look for common syntax errors
        try {
          const content = fs.readFileSync(path.join(targetDir, cfg.file), 'utf8');
          // Check for tab indentation (common YAML error)
          if (/\t/.test(content)) {
            ciConfigValid = false;
            ciCdIssues.push({
              severity: 'warning',
              title: `CI config contains tabs`,
              file: cfg.file,
              line: null,
              message: `${cfg.name} configuration uses tabs for indentation, which is invalid YAML.`,
              fix: 'Replace tabs with spaces in the YAML configuration.',
            });
          }
          // Check for empty content
          if (content.trim().length === 0) {
            ciConfigValid = false;
            ciCdIssues.push({
              severity: 'warning',
              title: `Empty CI config`,
              file: cfg.file,
              line: null,
              message: `${cfg.name} configuration file is empty.`,
              fix: 'Add pipeline configuration or remove the empty file.',
            });
          }
        } catch {
          // Read error
        }
        break;
      }
    } else if (cfg.file === 'Jenkinsfile') {
      if (fileExists(targetDir, cfg.file)) {
        detectedCI = cfg.name;
        break;
      }
    } else {
      // Directory check (e.g., .github/workflows, .circleci)
      if (fs.existsSync(path.join(targetDir, cfg.file))) {
        detectedCI = cfg.name;
        // Check if directory has any YAML files
        try {
          const entries = fs.readdirSync(path.join(targetDir, cfg.file));
          const yamlFiles = entries.filter((e) => e.endsWith('.yml') || e.endsWith('.yaml'));
          if (yamlFiles.length === 0) {
            ciConfigValid = false;
            ciCdIssues.push({
              severity: 'warning',
              title: `Empty ${cfg.name} workflows directory`,
              file: cfg.file,
              line: null,
              message: `The ${cfg.name} workflows directory exists but contains no workflow files.`,
              fix: `Add workflow YAML files to ${cfg.file}/.`,
            });
          }
        } catch {
          // Read error
        }
        break;
      }
    }
  }

  const ciCdChecks: CheckSummary[] = [
    {
      slug: 'ci-provider',
      name: 'CI Provider',
      status: detectedCI ? 'pass' : 'warning',
      detail: detectedCI ? `${detectedCI} detected` : 'No CI/CD configuration found',
    },
  ];
  if (detectedCI) {
    ciCdChecks.push({
      slug: 'ci-config',
      name: 'CI Config',
      status: ciConfigValid ? 'pass' : 'warning',
      detail: ciConfigValid ? `${detectedCI} configuration valid` : 'CI configuration has issues',
    });
  }

  // --- Rollback ---
  const rollbackIssues: Issue[] = [];
  const rollbackChecks: CheckSummary[] = [];

  // Check git tags for version tags
  const tagsRes = await runCommand(['git', 'tag', '-l'], { timeoutMs: 10_000, signal, cwd: targetDir });
  const tags = tagsRes.exitCode === 0
    ? tagsRes.stdout.split(/\r?\n/).filter((t) => t.trim()).slice(0, 50)
    : [];
  const versionTags = tags.filter((t) => /^v?\d+\.\d+/.test(t));

  if (tagsRes.exitCode !== 0) {
    rollbackChecks.push({
      slug: 'tags',
      name: 'Version Tags',
      status: 'pass',
      detail: 'Not a git repository',
    });
  } else {
    rollbackChecks.push({
      slug: 'tags',
      name: 'Version Tags',
      status: versionTags.length > 0 ? 'pass' : 'warning',
      detail: versionTags.length > 0
        ? `${versionTags.length} version tag(s) found (latest: ${versionTags[versionTags.length - 1]})`
        : 'No version tags found — previous versions may not be recoverable',
    });
    if (versionTags.length === 0) {
      rollbackIssues.push({
        severity: 'warning',
        title: 'No version tags found',
        file: null,
        line: null,
        message: 'The repository has no semantic version tags (v1.0.0, etc.). Rolling back to a specific version may be difficult.',
        fix: 'Tag releases with semantic versions (e.g., `git tag v1.0.0`).',
      });
    }
  }

  // Check for backup/rollback config files
  const rollbackConfigFiles = ['rollback.config.js', 'rollback.config.ts', '.rollback'];
  let hasRollbackConfig = false;
  for (const rf of rollbackConfigFiles) {
    if (fileExists(targetDir, rf)) {
      hasRollbackConfig = true;
      break;
    }
  }
  rollbackChecks.push({
    slug: 'config',
    name: 'Rollback Config',
    status: 'pass',
    detail: hasRollbackConfig ? 'Rollback configuration found' : 'No rollback configuration (optional)',
  });

  // --- Security ---
  const secretIssues = scanForSecrets(targetDir);
  const envIssues = envExampleCheck(targetDir);

  // Detect console.log, console.debug, debugger statements in source
  const debugIssues: Issue[] = [];
  const debugPatterns: { name: string; pattern: RegExp }[] = [
    { name: 'console.log', pattern: /\bconsole\.\s*log\s*\(/g },
    { name: 'console.debug', pattern: /\bconsole\.\s*debug\s*\(/g },
    { name: 'debugger', pattern: /\bdebugger\s*[;,]?/g },
  ];
  const debugWalk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (WS_EXCLUDE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.env')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        debugWalk(full);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        let content: string;
        try {
          content = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        const rel = path.relative(targetDir, full);
        for (const dp of debugPatterns) {
          let match: RegExpExecArray | null;
          dp.pattern.lastIndex = 0;
          while ((match = dp.pattern.exec(content)) !== null) {
            const line = content.slice(0, match.index).split(/\r?\n/).length;
            debugIssues.push({
              severity: 'warning',
              title: `${dp.name} left in source`,
              file: rel,
              line,
              message: `A \`${dp.name}\` statement was found in source code.`,
              fix: `Remove the \`${dp.name}\` statement before deploying to production.`,
            });
          }
        }
      }
    }
  };
  debugWalk(targetDir);

  const securityIssues = [...secretIssues, ...envIssues, ...debugIssues];
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
    {
      slug: 'debug-statements',
      name: 'Debug statements',
      status: debugIssues.length > 0 ? 'warning' : 'pass',
      detail: debugIssues.length > 0 ? `${debugIssues.length} debug statement(s) found` : 'No debug statements detected',
    },
  ];

  const categories: CategoryResult[] = [
    toCategory({ slug: 'environment', name: 'Environment', checks: envChecks, issues: [] }),
    toCategory({ slug: 'git', name: 'Git', checks: gitChecks, issues: gitIssues }),
    toCategory({ slug: 'dependencies', name: 'Dependencies', checks: depChecks, issues: auditIssues }),
    toCategory({ slug: 'build', name: 'Build', checks: buildChecks, issues: buildIssues }),
    toCategory({ slug: 'tests', name: 'Tests', checks: testChecks, issues: testIssues }),
    toCategory({ slug: 'code_quality', name: 'Code Quality', checks: [{ slug: 'code-quality', name: 'Coming in Phase 2', status: 'pass', detail: 'ESLint integration planned' }], issues: [] }),
    toCategory({ slug: 'docker', name: 'Docker', checks: dockerChecks, issues: dockerIssues }),
    toCategory({ slug: 'database', name: 'Database', checks: databaseChecks, issues: dbIssues }),
    toCategory({ slug: 'ci_cd', name: 'CI/CD', checks: ciCdChecks, issues: ciCdIssues }),
    toCategory({ slug: 'deployment', name: 'Deployment', checks: [{ slug: 'deployment', name: 'Coming in Phase 2', status: 'pass', detail: 'Config validation planned' }], issues: [] }),
    toCategory({ slug: 'security', name: 'Security', checks: securityChecks, issues: securityIssues }),
    toCategory({ slug: 'rollback', name: 'Rollback', checks: rollbackChecks, issues: rollbackIssues }),
    toCategory({ slug: 'monitoring', name: 'Monitoring', checks: [{ slug: 'monitoring', name: 'Coming in Phase 2', status: 'pass', detail: 'Sentry/error-boundary detection planned' }], issues: [] }),
    toCategory({ slug: 'api_check', name: 'API Check', checks: [{ slug: 'api-check', name: 'Coming in Phase 3', status: 'pass', detail: 'HTTP probing planned' }], issues: [] }),
    toCategory({ slug: 'performance', name: 'Performance', checks: [{ slug: 'performance', name: 'Coming in Phase 3', status: 'pass', detail: 'Lighthouse integration planned' }], issues: [] }),
    toCategory({ slug: 'post_deployment', name: 'Post-Deploy', checks: [{ slug: 'post-deploy', name: 'Coming in Phase 3', status: 'pass', detail: 'Smoke testing planned' }], issues: [] }),
  ];

  const issues: Issue[] = [
    ...secretIssues,
    ...envIssues,
    ...buildIssues,
    ...testIssues,
    ...dockerIssues,
    ...gitIssues,
    ...auditIssues,
    ...debugIssues,
    ...dbIssues,
    ...ciCdIssues,
    ...rollbackIssues,
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
