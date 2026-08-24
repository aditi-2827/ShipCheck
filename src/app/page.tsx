const categoryData = [
  {
    name: 'Environment',
    status: 'pass',
    score: '18/18',
    checks: 3,
    items: [
      { state: 'pass', text: '.env detected' },
      { state: 'pass', text: 'Required variables present' },
      { state: 'warning', text: '.env.example outdated' },
      { state: 'fail', text: 'Secret detected in source' },
    ],
  },
  {
    name: 'Git',
    status: 'warning',
    score: '10/12',
    checks: 3,
    items: [
      { state: 'pass', text: 'Repository clean' },
      { state: 'pass', text: '.gitignore detected' },
      { state: 'warning', text: '3 uncommitted files' },
      { state: 'fail', text: '.env tracked by Git' },
    ],
  },
  {
    name: 'Dependencies',
    status: 'warning',
    score: '8/10',
    checks: 3,
    items: [
      { state: 'pass', text: 'Dependencies installed' },
      { state: 'warning', text: '4 outdated packages' },
      { state: 'pass', text: 'Lockfile detected' },
    ],
  },
  {
    name: 'Build',
    status: 'pass',
    score: '12/12',
    checks: 2,
    items: [
      { state: 'pass', text: 'Build successful' },
      { state: 'pass', text: 'Type checking passed' },
    ],
  },
  {
    name: 'Tests',
    status: 'pass',
    score: '42/42',
    checks: 2,
    items: [
      { state: 'pass', text: '42 tests passed' },
      { state: 'pass', text: '0 failed' },
    ],
  },
  {
    name: 'Docker',
    status: 'warning',
    score: '8/10',
    checks: 3,
    items: [
      { state: 'pass', text: 'Dockerfile detected' },
      { state: 'pass', text: 'Docker configuration valid' },
      { state: 'warning', text: 'Image could be optimized' },
    ],
  },
  {
    name: 'Security',
    status: 'warning',
    score: '6/8',
    checks: 3,
    items: [
      { state: 'pass', text: 'No obvious credentials found' },
      { state: 'fail', text: 'API key detected in source' },
      { state: 'warning', text: 'Unsafe configuration detected' },
    ],
  },
] as const;

const issues = [
  {
    severity: 'critical',
    title: 'Secret detected in source',
    file: 'src/config/api.js',
    line: 12,
    message: 'A private token is embedded in source code and would be exposed in a public repository or build artifact.',
    fix: 'Move the secret to an environment variable and ensure it is excluded from Git tracking.',
  },
  {
    severity: 'warning',
    title: '.env.example is missing DATABASE_URL',
    file: '.env.example',
    line: null,
    message: 'The environment template does not declare a required configuration value for the project runtime.',
    fix: 'Add DATABASE_URL to the example file and document its expected format.',
  },
  {
    severity: 'warning',
    title: '3 uncommitted files detected',
    file: 'git status',
    line: null,
    message: 'There are local changes that have not been reviewed before shipping.',
    fix: 'Review, commit, or intentionally exclude the modified files before deployment.',
  },
] as const;

const pipelineStages = [
  { label: 'Discovery', state: 'done' },
  { label: 'Environment', state: 'done' },
  { label: 'Git', state: 'done' },
  { label: 'Dependencies', state: 'done' },
  { label: 'Tests', state: 'running' },
  { label: 'Build', state: 'pending' },
  { label: 'Docker', state: 'pending' },
  { label: 'Security', state: 'pending' },
] as const;

function StatusGlyph({ state }: { state: 'pass' | 'warning' | 'fail' }) {
  if (state === 'pass') {
    return <span className="checkmark bg-success/15 text-success">✓</span>;
  }
  if (state === 'warning') {
    return <span className="checkmark bg-warning/15 text-warning">!</span>;
  }
  return <span className="checkmark bg-danger/15 text-danger">✗</span>;
}

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-text">
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <header className="mb-10 flex items-center justify-between border-b border-border/80 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-panelAlt text-[11px] font-bold uppercase tracking-[0.2em] text-success">
              SC
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">ShipCheck</div>
            </div>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
            {['Overview', 'Checks', 'Issues', 'Pipeline', 'History', 'Settings'].map((item) => (
              <a key={item} href="#" className="transition hover:text-text">
                {item}
              </a>
            ))}
          </nav>
          <div className="status-pill border-success/30 bg-success/10 text-success">
            <span className="h-2 w-2 rounded-full bg-success" />
            LOCAL
          </div>
        </header>

        <section className="mb-12 grid gap-10 border-b border-border/80 pb-12 pt-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-panelAlt px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              <span className="h-2 w-2 rounded-full bg-success" />
              Local-first deployment intelligence
            </div>
            <h1 className="max-w-xl text-5xl font-semibold tracking-tight text-text sm:text-6xl">
              Ship with confidence.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted">
              ShipCheck scans your project, finds deployment risks, and tells you whether you&apos;re actually ready to ship.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <button className="rounded-md border border-success/40 bg-success/10 px-5 py-3 text-sm font-medium text-success transition hover:bg-success/15">
                Run a ShipCheck
              </button>
              <button className="rounded-md border border-border bg-panelAlt px-5 py-3 text-sm font-medium text-text transition hover:border-border/80 hover:bg-panel">
                View GitHub
              </button>
            </div>
            <div className="terminal mt-10 max-w-2xl rounded-xl border border-border bg-panelAlt p-4 shadow-glow">
              <div className="mb-4 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-danger/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-success/80" />
              </div>
              <div className="space-y-2 text-sm text-muted">
                <p>$ shipcheck</p>
                <p>Scanning project...</p>
                <p>✓ Git repository detected</p>
                <p>✓ Environment configuration</p>
                <p>✓ Dependencies</p>
                <p>✓ Tests</p>
                <p>✓ Build</p>
                <p>✓ Docker configuration</p>
                <div className="mt-4 pt-2 text-success">
                  <p>Ship Score: 91/100</p>
                  <p>STATUS: READY TO SHIP</p>
                </div>
              </div>
            </div>
          </div>

          <div className="panel p-6">
            <div className="mb-5 flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">Ship Score</div>
              <div className="status-pill border-success/30 bg-success/10 text-success">READY TO SHIP</div>
            </div>
            <div className="flex items-center justify-center py-4">
              <div className="score-ring flex items-center justify-center">
                <div className="relative z-10 text-center">
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted">91</div>
                  <div className="mt-2 text-4xl font-semibold text-text">91</div>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">/100</div>
                </div>
              </div>
            </div>
            <div className="mt-5 border-t border-border pt-5">
              <div className="flex items-center justify-between text-sm text-muted">
                <span>12 checks passed</span>
                <span>2 warnings</span>
              </div>
              <div className="mt-2 text-sm text-muted">0 critical issues</div>
            </div>
          </div>
        </section>

        <section className="mb-14">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">Overview</div>
              <h2 className="mt-2 text-2xl font-semibold text-text">Deployment readiness</h2>
            </div>
            <button className="rounded-md border border-border bg-panelAlt px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-text">
              Run scan
            </button>
          </div>

          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {categoryData.map((category) => (
              <div key={category.name} className="panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{category.name}</div>
                    <div className="mt-2 text-2xl font-semibold">{category.score}</div>
                  </div>
                  <div className="status-pill border-success/30 bg-success/10 text-success">{category.status === 'pass' ? 'PASS' : 'WARN'}</div>
                </div>
                <div className="space-y-3">
                  {category.items.map((item) => (
                    <div key={`${category.name}-${item.text}`} className="flex items-center gap-3 text-sm text-text">
                      <StatusGlyph state={item.state} />
                      <span className={item.state === 'fail' ? 'text-danger' : item.state === 'warning' ? 'text-warning' : 'text-text'}>{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-14 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="panel p-5">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">Issues</div>
                <h3 className="mt-2 text-2xl font-semibold">Issue explorer</h3>
              </div>
            </div>
            <div className="space-y-4">
              {issues.map((issue) => (
                <div key={issue.title} className="soft-panel p-4">
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <div className={`status-pill ${issue.severity === 'critical' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-warning/30 bg-warning/10 text-warning'}`}>
                      {issue.severity.toUpperCase()}
                    </div>
                    <button className="text-xs text-muted transition hover:text-text">Mark as reviewed</button>
                  </div>
                  <div className="font-semibold text-text">{issue.title}</div>
                  <div className="mt-1 font-mono text-xs text-muted">
                    {issue.file}{issue.line ? `: ${issue.line}` : ''}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted">{issue.message}</p>
                  <div className="mt-3 rounded-md border border-border bg-panelAlt p-3">
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Recommendation</div>
                    <div className="text-sm text-text">{issue.fix}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">Pipeline</div>
            <h3 className="mt-2 text-2xl font-semibold">Scan flow</h3>
            <div className="mt-6 flex flex-wrap gap-3">
              {pipelineStages.map((stage, index) => (
                <div key={stage.label} className="flex items-center gap-3">
                  <div className={`pipeline-node ${stage.state === 'done' ? 'active' : stage.state === 'running' ? 'warning' : ''}`}>
                    {stage.state === 'done' ? '✓' : stage.state === 'running' ? '⟳' : '○'}
                  </div>
                  {index < pipelineStages.length - 1 && <div className="h-px w-6 bg-border" />}
                </div>
              ))}
            </div>
            <div className="mt-8 space-y-3 font-mono text-sm text-muted">
              <div className="scan-line">Detecting project type</div>
              <div className="scan-line">Reading package.json</div>
              <div className="scan-line">Checking environment</div>
              <div className="scan-line">Inspecting Git</div>
              <div className="scan-line running">Running tests</div>
              <div className="scan-line pending">Running build</div>
              <div className="scan-line pending">Inspecting Docker</div>
              <div className="scan-line pending">Security scan</div>
            </div>
          </div>
        </section>

        <section className="mb-14 grid gap-8 lg:grid-cols-2">
          <div className="panel p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">History</div>
            <h3 className="mt-2 text-2xl font-semibold">Scan history</h3>
            <div className="mt-6 space-y-6">
              <div>
                <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Today</div>
                <div className="space-y-2 text-sm text-text">
                  <div className="flex items-center justify-between rounded-md border border-border bg-panelAlt px-3 py-2">
                    <span>91/100</span>
                    <span className="text-success">READY</span>
                    <span className="text-muted">main</span>
                  </div>
                  
                  <div className="flex items-center justify-between rounded-md border border-border bg-panelAlt px-3 py-2">
                    <span>72/100</span>
                    <span className="text-danger">BLOCKED</span>
                    <span className="text-muted">feature/auth</span>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-border bg-panelAlt px-3 py-2">
                    <span>86/100</span>
                    <span className="text-warning">WARNING</span>
                    <span className="text-muted">develop</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">CI/CD</div>
            <h3 className="mt-2 text-2xl font-semibold">Pipeline integration</h3>
            <div className="mt-6 space-y-4 text-sm text-muted">
              <div className="font-mono text-xs text-text">Git Push → GitHub Actions → ShipCheck → Run Checks → Calculate Score</div>
              <div className="flex items-center gap-3">
                <div className="h-2.5 w-2.5 rounded-full bg-success" />
                <span className="text-text">Score &gt;= 80</span>
                <span className="text-success">PASS ✓</span>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-2.5 w-2.5 rounded-full bg-danger" />
                <span className="text-text">Score &lt; 80</span>
                <span className="text-danger">BLOCK DEPLOYMENT</span>
              </div>
            </div>

            <div className="terminal mt-6 rounded-lg border border-border bg-panelAlt p-4 text-xs text-muted">
              <p>name: deploy</p>
              <p>on: [push]</p>
              <p>jobs:</p>
              <p>  shipcheck:</p>
              <p>    runs-on: ubuntu-latest</p>
              <p>    steps:</p>
              <p>      - uses: actions/checkout@v4</p>
              <p>      - run: pip install shipcheck</p>
              <p>      - run: shipcheck --ci</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
