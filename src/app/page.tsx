'use client';

import { useState } from 'react';

const categoryData = [
  { name: 'Environment', status: 'pass', score: '18/18' },
  { name: 'Git', status: 'warning', score: '10/12' },
  { name: 'Dependencies', status: 'warning', score: '8/10' },
  { name: 'Build', status: 'pass', score: '12/12' },
  { name: 'Tests', status: 'pass', score: '42/42' },
  { name: 'Docker', status: 'warning', score: '8/10' },
  { name: 'Security', status: 'critical', score: '6/8' },
] as const;

const issues = [
  { severity: 'critical', title: 'Secret detected in source', file: 'src/config/api.js', line: 12, message: 'A private token is embedded in source code and would be exposed in a public repository or build artifact.', fix: 'Move the secret to an environment variable and ensure it is excluded from Git tracking.' },
  { severity: 'warning', title: '.env.example is missing DATABASE_URL', file: '.env.example', line: null, message: 'The environment template does not declare a required configuration value for the project runtime.', fix: 'Add DATABASE_URL to the example file and document its expected format.' },
  { severity: 'warning', title: '3 uncommitted files detected', file: 'git status', line: null, message: 'There are local changes that have not been reviewed before shipping.', fix: 'Review, commit, or intentionally exclude the modified files before deployment.' },
] as const;

const stages = ['Discover', 'Config', 'Git', 'Dependencies', 'Tests', 'Build', 'Docker', 'Security', 'Ship'];

type State = 'pass' | 'warning' | 'critical' | 'running' | 'pending';

function Marker({ state }: { state: State }) {
  return <span className={`marker marker-${state}`}>{state === 'pass' ? '✓' : state === 'warning' ? '!' : state === 'critical' ? '×' : state === 'running' ? '↻' : '·'}</span>;
}

export default function Home() {
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState('all');
  const shownIssues = filter === 'all' ? issues : issues.filter((issue) => issue.severity === filter);
  const runScan = () => { setScanning(true); window.setTimeout(() => setScanning(false), 2400); };

  return (
    <main className="min-h-screen"><div className="shell">
      <header className="topbar"><a href="#top" className="brand"><span className="brand-mark">SC</span><span>SHIPCHECK</span><small>LOCAL-FIRST / v1.0</small></a><nav className="nav" aria-label="Primary navigation">{['Overview', 'Checks', 'Issues', 'Pipeline', 'History', 'Settings'].map((item, index) => <a key={item} href={`#${item.toLowerCase()}`} className={index === 0 ? 'nav-active' : ''}><b>0{index + 1}</b>{item}<kbd>G {item[0]}</kbd></a>)}</nav><div className="local-state"><i /> LOCAL</div></header>

      <section id="top" className="hero"><div className="hero-copy"><p className="eyebrow"><span className="signal" /> DEPLOYMENT INTELLIGENCE / LOCAL-FIRST</p><h1><strong>SHIP</strong><em>with</em><strong className="accent-text">CONFIDENCE.</strong></h1><p className="hero-lede">Know what is healthy, what needs attention, and what blocks deployment before your code leaves the machine.</p><div className="actions"><button className="primary-button" onClick={runScan}><span>{scanning ? '↻' : '▶'}</span>{scanning ? 'SCANNING...' : 'RUN SHIPCHECK'}</button><a className="text-button" href="#issues">VIEW ISSUES <span>↗</span></a></div></div><aside className="status-instrument"><div className="instrument-head"><span>SHIPCHECK STATUS</span><span className="live"><i /> LIVE</span></div><div className="ready-row"><Marker state="pass" /><span>{scanning ? 'SCAN IN PROGRESS' : 'SYSTEM READY'}</span></div><div className="instrument-meta"><span>LAST SCAN</span><strong>{scanning ? 'NOW / ACTIVE' : '2 MINUTES AGO'}</strong></div><div className="score-big">91<small>/100</small></div><div className="ready-label">READY TO SHIP <span>✓</span></div><div className="score-bar"><span /></div></aside></section>

      <section className="overview-section" id="overview"><div className="section-heading"><div><p className="eyebrow">01 / OVERVIEW</p><h2>Deployment health</h2></div><button className="quiet-button" onClick={runScan}>{scanning ? 'SCAN IN PROGRESS' : 'RUN NEW SCAN'} <span>↗</span></button></div><div className="health-grid"><div className="health-feature"><div className="feature-top"><div><p className="eyebrow">CURRENT SHIP SCORE</p><div className="feature-score">91 <small>/ 100</small></div></div><div className="ready-stamp">READY <span>✓</span></div></div><div className="segmented-bar">{Array.from({ length: 10 }, (_, index) => <i key={index} />)}</div><div className="feature-foot"><span><b className="green-text">32</b> CHECKS PASSED</span><span><b className="amber-text">3</b> WARNINGS</span><span><b className="red-text">0</b> BLOCKERS</span></div></div><div className="category-grid">{categoryData.map((category) => <div className={`category ${category.status === 'critical' ? 'category-critical' : ''}`} key={category.name}><div className="category-top"><p className="eyebrow">{category.name}</p><Marker state={category.status} /></div><strong>{category.score}</strong><div className="category-state"><i className={`state-dot ${category.status}`} /> {category.status === 'pass' ? 'HEALTHY' : category.status === 'critical' ? 'CRITICAL' : 'WARNING'}</div></div>)}</div></div></section>

      <section className="split-section" id="issues"><div className="issue-panel"><div className="section-heading compact"><div><p className="eyebrow">02 / ISSUES</p><h2>Issue explorer</h2></div><span className="count-badge">{issues.length} OPEN</span></div><div className="filters">{[['all', 'ALL', issues.length], ['critical', 'CRITICAL', 1], ['warning', 'WARNING', 2], ['info', 'INFO', 0]].map(([key, label, count]) => <button key={key} className={filter === key ? `filter-active filter-${key}` : ''} onClick={() => setFilter(String(key))}>{label} <b>{count}</b></button>)}</div><div className="issue-list">{shownIssues.map((issue) => <article className={`issue ${issue.severity}`} key={issue.title}><div className="issue-severity"><Marker state={issue.severity === 'critical' ? 'critical' : 'warning'} /> {issue.severity.toUpperCase()}</div><h3>{issue.title}</h3><code>{issue.file}{issue.line ? `:${issue.line}` : ''}</code><p>{issue.message}</p><div className="recommendation"><span>RECOMMENDATION</span>{issue.fix}</div><div className="issue-actions"><button>MARK REVIEWED</button><button>VIEW FILE ↗</button></div></article>)}</div></div>

      <div className="pipeline-panel" id="pipeline"><div className="section-heading compact"><div><p className="eyebrow">03 / PIPELINE</p><h2>Scan flow</h2></div><span className="running-label"><i /> {scanning ? 'RUNNING' : 'STANDBY'}</span></div><div className="pipeline">{stages.map((stage, index) => { const state: State = scanning && index === 4 ? 'running' : index < 5 ? 'pass' : 'pending'; return <div className={`stage stage-${state}`} key={stage}><Marker state={state} /><span>{stage}</span>{index < stages.length - 1 && <i className="stage-line" />}</div>; })}</div><div className="terminal"><div className="terminal-bar"><span /> <span /> <span /><b>shipcheck / scan.log</b></div><div className="terminal-lines"><p><b>$</b> shipcheck scan --local</p><p><span className="green-text">✓</span> detecting project ............ passed</p><p><span className="green-text">✓</span> checking environment ......... passed</p><p><span className="green-text">✓</span> inspecting git ............... passed</p><p><span className="amber-text">!</span> checking dependencies ........ warning</p><p><span className="green-text">✓</span> running tests ................ passed</p><p className="terminal-rule">----------------------------------------</p><p className="terminal-result">SHIP SCORE <strong>91 / 100</strong></p><p>STATUS <strong className="green-text">READY TO SHIP</strong></p><span className="cursor" /></div></div></div></section>

      <section className="bottom-grid" id="history"><div className="history-panel"><div className="section-heading compact"><div><p className="eyebrow">04 / HISTORY</p><h2>Scan timeline</h2></div><span className="muted-label">TODAY</span></div><div className="timeline">{[['09:42', '91', 'READY', 'main', 'green-text', '+19'], ['08:13', '72', 'BLOCKED', 'feature/auth', 'red-text', '-8'], ['07:50', '86', 'WARNING', 'develop', 'amber-text', '0']].map((row) => <div className="timeline-row" key={row[0]}><time>{row[0]}</time><strong>{row[1]}<small>/100</small></strong><span className={row[4]}>{row[2]}</span><code>{row[3]}</code><small className={row[5] === '0' ? '' : row[5].startsWith('+') ? 'green-text' : 'red-text'}>{row[5] === '0' ? '→ 0' : row[5].startsWith('+') ? `↑ ${row[5]}` : `↓ ${row[5]}`}</small></div>)}</div></div><div className="cicd-panel"><div className="section-heading compact"><div><p className="eyebrow violet-label">05 / CI/CD</p><h2>Automation gate</h2></div><span className="violet-label">GITHUB ACTIONS</span></div><div className="automation-flow"><span>PUSH</span><i>→</i><span>SHIPCHECK</span><i>→</i><span>SCAN</span><i>→</i><strong>≥ 80<br /><b>PASS ✓</b></strong><i>→</i><span>DEPLOY</span></div><p className="cicd-note">Every push gets a readiness score before it reaches production.</p></div></section>
      <footer><span>SHIPCHECK / KNOW BEFORE YOU SHIP</span><span>ALL SYSTEMS NOMINAL <i /></span></footer>
    </div></main>
  );
}
