import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CategoryResult, CheckSummary, Issue, ScanResult } from './types';
import { appendHistory } from './store';
import { ApiError } from './http';

const ROOT = process.cwd();

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

// Resolve a hard-coded command program into a shell-free execFile invocation.
// npm is launched via the node binary + npm-cli.js (no shell). node uses the
// running binary explicitly. Everything else (git) is assumed to be a real
// executable that execFile can find in PATH without a shell.
function planSpawn(args: string[]): { file: string; cmdArgs: string[] } {
  const [program, ...rest] = args;
  if (program === 'npm') {
    const npmCli = resolveNpmCli();
    if (npmCli) {
      return { file: process.execPath, cmdArgs: [npmCli, ...rest] };
    }
    // Fallback for environments where npm-cli.js cannot be located (e.g. a
    // system npm not bundled with node). On POSIX npm is a real shebang script
    // that execFile can spawn directly.
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
        cwd: opts.cwd ?? ROOT,
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

function fileExists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

// ---------------------------------------------------------------------------
// Isolated temporary workspace for executable checks (build / test / audit).
//
// The real repository is only ever *inspected* (git, secrets, .env.example,
// Dockerfile, package metadata). Build/test execution happens in a scratch
// directory that reuses node_modules through a Windows directory junction, so
// npm run build generates its own .next there and NEVER touches the live
// serving application's ROOT/.next.
// ---------------------------------------------------------------------------

// Minimal set of files needed to run npm audit / npm run build / npm test in
// the isolated workspace. src/ is copied in full (the app code to compile).
const WORKSPACE_CONFIG_FILES: string[] = [
  'package.json',
  'package-lock.json',
  'next.config.mjs',
  'next-env.d.ts',
  'tsconfig.json',
  'tailwind.config.ts',
  'postcss.config.js',
  '.eslintrc.json',
];

interface TempWorkspace {
  dir: string;
}

function copyTree(src: string, dest: string, copyNominee: (rel: string) => boolean): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const rel = entry.name;
    if (entry.name.startsWith('.env')) continue; // never copy any environment file/secret
    if (rel === 'node_modules' || rel === '.next' || rel === '.data' || rel === '.git') continue;
    const from = path.join(src, rel);
    if (entry.isDirectory()) {
      if (copyNominee(rel)) {
        const to = path.join(dest, rel);
        fs.mkdirSync(to, { recursive: true });
        copyTree(from, to, copyNominee);
      }
    } else {
      if (copyNominee(rel)) {
        fs.copyFileSync(from, path.join(dest, rel));
      }
    }
  }
}

function createTempWorkspace(): TempWorkspace {
  // Workspace lives under the gitignored runtime area (never served, never
  // public). Randomized name avoids collisions.
  const base = path.join(ROOT, '.data', 'tmp');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'scan-'));

  // Copy the minimal source/config set needed to execute the build/tests.
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const file of WORKSPACE_CONFIG_FILES) {
    if (fs.existsSync(path.join(ROOT, file))) {
      fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
    }
  }
  const srcRoot = path.join(ROOT, 'src');
  if (fs.existsSync(srcRoot)) {
    copyTree(srcRoot, path.join(dir, 'src'), () => true);
  }

  // Reuse the installed dependencies through a Windows directory junction.
  // No copy, no reinstall; the build resolves modules through the junction.
  const realNodeModules = path.join(ROOT, 'node_modules');
  const wsNodeModules = path.join(dir, 'node_modules');
  if (fs.existsSync(realNodeModules)) {
    try {
      // 'junction' works on Windows without elevated privileges and maps the
      // whole directory tree.
      fs.symlinkSync(realNodeModules, wsNodeModules, 'junction');
    } catch {
      // Re-throw: do NOT silently fall back to copying or re-installing or to
      // a weaker isolation strategy. Report so the caller can surface it.
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
    // rmSync removes the junction target contents; ensure we only ever target
    // a scan-* directory under the runtime tmp area (never ROOT).
    if (path.basename(ws.dir).startsWith('scan-') && base.endsWith(path.join('.data', 'tmp'))) {
      fs.rmSync(ws.dir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup; a leftover randomized, secret-free dir under
    // gitignored .data/tmp is benign and will be reclaimed by the OS.
  }
}

async function withTempWorkspace<T>(fn: (ws: TempWorkspace) => Promise<T>): Promise<T> {
  const ws = createTempWorkspace();
  try {
    return await fn(ws);
  } finally {
    destroyTempWorkspace(ws);
  }
}

// Same Windows-safe spawn planning as planSpawn(), but executed in a specific
// working directory so the real repository directory is never the cwd for
// build/test/audit commands (their .next lands in the isolated workspace).
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

const REQUIRED_ENV_VARS = ['DATABASE_URL'];

function scanForSecrets(): Issue[] {
  const found: Issue[] = [];
  const roots = ['src'];

  for (const root of roots) {
    if (!fs.existsSync(path.join(ROOT, root))) continue;
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx|js|jsx|env|json)$/.test(entry.name)) {
          let content: string;
          try {
            content = fs.readFileSync(full, 'utf8');
          } catch {
            continue;
          }
          const rel = path.relative(ROOT, full);
          for (const p of SECRET_PATTERNS) {
            const match = content.match(p.pattern);
            if (match && match.index !== undefined) {
              const line = content.slice(0, match.index).split(/\r?\n/).length;
              found.push({
                severity: 'critical',
                title: `Possible ${p.name} in source`,
                file: rel,
                line,
                message: `A pattern matching "${p.name}" was found in a tracked source file.`,
                fix: 'Remove the secret, move it to an environment variable, and ensure it is excluded from Git tracking.',
              });
              break;
            }
          }
        }
      }
    };
    walk(path.join(ROOT, root));
  }
  return found;
}

function envExampleCheck(): Issue[] {
  const issues: Issue[] = [];
  if (!fileExists('.env.example')) {
    issues.push({
      severity: 'warning',
      title: '.env.example is missing',
      file: '.env.example',
      line: null,
      message: 'The repository does not ship an environment template.',
      fix: 'Create a .env.example documenting all required environment variables.',
    });
    return issues;
  }
  let content: string;
  try {
    content = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  } catch {
    return issues;
  }
  const declared = new Set(
    content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('=')[0].trim()),
  );
  for (const name of REQUIRED_ENV_VARS) {
    if (!declared.has(name)) {
      issues.push({
        severity: 'warning',
        title: `.env.example is missing ${name}`,
        file: '.env.example',
        line: null,
        message: `The environment template does not declare required value "${name}".`,
        fix: `Add ${name} to the example file and document its expected format.`,
      });
    }
  }
  return issues;
}

function packageJsonTestScript(): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return Boolean(pkg.scripts && typeof pkg.scripts.test === 'string' && pkg.scripts.test.length > 0);
  } catch {
    return false;
  }
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

export async function runScan(): Promise<ScanResult> {
  if (activeScan) {
    throw new ApiError('CONFLICT', 'A scan is already running. Wait for it to finish.', 409);
  }
  activeScan = true;
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), SCAN_GLOBAL_DEADLINE_MS);
  try {
    const result = await scanBody(controller.signal);
    if (controller.signal.aborted) {
      throw new ApiError('SCAN_FAILED', 'Scan exceeded the global time limit', 503);
    }
    void appendHistory(result);
    return result;
  } finally {
    clearTimeout(deadlineTimer);
    activeScan = false;
  }
}

async function scanBody(signal: AbortSignal): Promise<ScanResult> {
  const started = Date.now();

  // --- Environment ---
  const nodeRes = await runCommand(['node', '--version'], { timeoutMs: 10_000, signal });
  const npmRes = await runCommand(['npm', '--version'], { timeoutMs: 10_000, signal });
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
  const branchRes = await runCommand(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 10_000, signal });
  const statusRes = await runCommand(['git', 'status', '--porcelain'], { timeoutMs: 10_000, signal });
  const commitRes = await runCommand(['git', 'rev-parse', '--short', 'HEAD'], { timeoutMs: 10_000, signal });
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
  // These run in an isolated temporary workspace (own .next, node_modules
  // joined), so they never write into the live serving project's ROOT/.next.
  // Inspection logic (manifest presence, test-script presence) still reads the
  // real repository; only command *execution* happens in the workspace.
  const { auditIssues, depSummary, depStatus, buildIssues, buildStatus, buildSummary, testIssues, testStatus, testSummary } =
    await withTempWorkspace(async (ws) => {
      const auditIssues: Issue[] = [];
      let depSummary = 'not run';
      let depStatus: CheckSummary['status'] = 'pass';
      if (fileExists('package-lock.json') || fileExists('package.json')) {
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
      if (fileExists('package.json')) {
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
      } else {
        buildStatus = 'warning';
        buildSummary = 'No package.json to build';
      }

      const testIssues: Issue[] = [];
      let testStatus: CheckSummary['status'] = 'pass';
      let testSummary = 'No test suite configured';
      if (packageJsonTestScript()) {
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
  if (fileExists('Dockerfile') || fileExists('docker-compose.yml') || fileExists('compose.yaml')) {
    dockerStatus = 'pass';
    dockerSummary = 'Docker configuration present';
    if (fileExists('Dockerfile')) {
      const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
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
  const secretIssues = scanForSecrets();
  const envIssues = envExampleCheck();
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

  let score = 100;
  score -= blockers * 15;
  score -= warnings * 5;
  score = Math.max(0, Math.min(100, score));

  const status = score >= 80 ? 'READY' : score >= 60 ? 'WARNING' : 'BLOCKED';

  const result: ScanResult = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
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
