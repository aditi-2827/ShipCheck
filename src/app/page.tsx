'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getFeed,
  getHistory,
  runScan as apiRunScan,
  ClientApiError,
} from '@/lib/api';
import type { FeedData, ScanResult } from '@/lib/types';

const fallbackStages = ['Discover', 'Config', 'Git', 'Dependencies', 'Tests', 'Build', 'Docker', 'Security', 'Ship'];

type State = 'pass' | 'warning' | 'critical' | 'running' | 'pending';

function Marker({ state }: { state: State }) {
  return <span className={`marker marker-${state}`}>{state === 'pass' ? '✓' : state === 'warning' ? '!' : state === 'critical' ? '×' : state === 'running' ? '↻' : '·'}</span>;
}

function CategoryLabel({ status }: { status: string }) {
  const text = status === 'pass' ? 'HEALTHY' : status === 'critical' ? 'CRITICAL' : status === 'pending' ? 'PENDING' : 'WARNING';
  return <>{text}</>;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface TimelineRow {
  time: string;
  score: number;
  status: string;
  branch: string;
  statusClass: string;
  delta: number;
}

export default function Home() {
  const [filter, setFilter] = useState('all');
  const [scanning, setScanning] = useState(false);
  const [feed, setFeed] = useState<FeedData | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [f, h] = await Promise.all([getFeed(), getHistory()]);
        if (cancelled) return;
        setFeed(f);
        setHistory(h);
      } catch {
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setErrorMsg('');
    try {
      const res = await apiRunScan();
      setResult(res);
      setHistory((prev) => [res, ...prev]);
    } catch (err) {
      if (err instanceof ClientApiError) {
        if (err.status === 409) {
          setErrorMsg('A scan is already running. Wait for it to finish.');
        } else if (err.status === 503) {
          setErrorMsg('The scan exceeded the global time limit.');
        } else {
          setErrorMsg(err.message);
        }
      } else {
        setErrorMsg('Scan failed. Could not reach the server.');
      }
    } finally {
      setScanning(false);
    }
  }, [scanning]);

  const categories: { name: string; status: string; score: string }[] = result
    ? result.categories.map((c) => ({ name: c.name, status: c.status, score: c.score }))
    : (feed?.categories ?? []).map((c) => ({ name: c.name, status: 'pending', score: '—' }));

  const scanIssues = result?.issues ?? [];
  const criticalCount = scanIssues.filter((i) => i.severity === 'critical').length;
  const warningCount = scanIssues.filter((i) => i.severity === 'warning').length;
  const infoCount = scanIssues.filter((i) => i.severity === 'info').length;
  const shownIssues = filter === 'all' ? scanIssues : scanIssues.filter((issue) => issue.severity === filter);

  const readyLabel = result
    ? result.status === 'READY'
      ? 'READY TO SHIP'
      : result.status === 'WARNING'
        ? 'WARNING'
        : 'BLOCKED'
    : 'PENDING';
  const score = result ? result.score : null;
  const lastScanLabel = scanning ? 'NOW / ACTIVE' : result ? formatTime(result.createdAt) : 'NO SCAN YET';

  const timelineRows: TimelineRow[] = history.map((h, i) => {
    const prev = history[i + 1];
    const delta = prev ? h.score - prev.score : 0;
    return {
      time: formatTime(h.createdAt),
      score: h.score,
      status: h.status,
      branch: h.env?.branch ?? 'n/a',
      statusClass: h.status === 'READY' ? 'green-text' : h.status === 'WARNING' ? 'amber-text' : 'red-text',
      delta,
    };
  });

  return (
    <main className="min-h-screen"><div className="shell">
      <header className="topbar"><a href="#top" className="brand"><span className="brand-mark">SC</span><span>SHIPCHECK</span><small>LOCAL-FIRST / v1.0</small></a><nav className="nav" aria-label="Primary navigation">{['Overview', 'Checks', 'Issues', 'Pipeline', 'History', 'Settings'].map((item, index) => <a key={item} href={`#${item.toLowerCase()}`} className={index === 0 ? 'nav-active' : ''}><b>0{index + 1}</b>{item}<kbd>G {item[0]}</kbd></a>)}</nav><div className="local-state"><i /> LOCAL</div></header>

      <section id="top" className="hero"><div className="hero-copy"><p className="eyebrow"><span className="signal" /> DEPLOYMENT INTELLIGENCE / LOCAL-FIRST</p><h1><strong>SHIP</strong><em>with</em><strong className="accent-text">CONFIDENCE.</strong></h1><p className="hero-lede">Know what is healthy, what needs attention, and what blocks deployment before your code leaves the machine.</p><div className="actions"><button className="primary-button" onClick={runScan}><span>{scanning ? '↻' : '▶'}</span>{scanning ? 'SCANNING...' : 'RUN SHIPCHECK'}</button><a className="text-button" href="#issues">VIEW ISSUES <span>↗</span></a></div>{errorMsg && <p className="red-text" style={{ font: '500 10px "JetBrains Mono", monospace', letterSpacing: '.08em', textTransform: 'uppercase', margin: '20px 0 0' }}>{errorMsg}</p>}</div><aside className="status-instrument"><div className="instrument-head"><span>SHIPCHECK STATUS</span><span className="live"><i /> LIVE</span></div><div className="ready-row"><Marker state="pass" /><span>{scanning ? 'SCAN IN PROGRESS' : 'SYSTEM READY'}</span></div><div className="instrument-meta"><span>LAST SCAN</span><strong>{lastScanLabel}</strong></div><div className="score-big">{score ?? '—'}<small>/100</small></div><div className="ready-label">{readyLabel} <span>✓</span></div><div className="score-bar"><span style={{ width: `${score ?? 0}%` }} /></div></aside></section>

      <section className="overview-section" id="overview"><div className="section-heading"><div><p className="eyebrow">01 / OVERVIEW</p><h2>Deployment health</h2></div><button className="quiet-button" onClick={runScan}>{scanning ? 'SCAN IN PROGRESS' : 'RUN NEW SCAN'} <span>↗</span></button></div><div className="health-grid"><div className="health-feature"><div className="feature-top"><div><p className="eyebrow">CURRENT SHIP SCORE</p><div className="feature-score">{score ?? '—'} <small>/ 100</small></div></div><div className="ready-stamp">{readyLabel} <span>✓</span></div></div><div className="segmented-bar">{Array.from({ length: 10 }, (_, index) => <i key={index} />)}</div><div className="feature-foot"><span><b className="green-text">{result ? result.checksRun : '—'}</b> CHECKS PASSED</span><span><b className="amber-text">{result ? result.warnings : '—'}</b> WARNINGS</span><span><b className="red-text">{result ? result.blockers : '—'}</b> BLOCKERS</span></div></div><div className="category-grid">{categories.map((category) => <div className={`category ${category.status === 'critical' ? 'category-critical' : ''}`} key={category.name}><div className="category-top"><p className="eyebrow">{category.name}</p><Marker state={category.status as State} /></div><strong>{category.score}</strong><div className="category-state"><i className={`state-dot ${category.status}`} /> <CategoryLabel status={category.status} /></div></div>)}</div></div></section>

      <section className="split-section" id="issues"><div className="issue-panel"><div className="section-heading compact"><div><p className="eyebrow">02 / ISSUES</p><h2>Issue explorer</h2></div><span className="count-badge">{scanIssues.length} OPEN</span></div><div className="filters">{[['all', 'ALL', scanIssues.length], ['critical', 'CRITICAL', criticalCount], ['warning', 'WARNING', warningCount], ['info', 'INFO', infoCount]].map(([key, label, count]) => <button key={key} className={filter === key ? `filter-active filter-${key}` : ''} onClick={() => setFilter(String(key))}>{label} <b>{count}</b></button>)}</div><div className="issue-list">{shownIssues.map((issue) => <article className={`issue ${issue.severity}`} key={issue.title}><div className="issue-severity"><Marker state={issue.severity === 'critical' ? 'critical' : issue.severity === 'warning' ? 'warning' : 'pending'} /> {issue.severity.toUpperCase()}</div><h3>{issue.title}</h3><code>{issue.file}{issue.line ? `:${issue.line}` : ''}</code><p>{issue.message}</p><div className="recommendation"><span>RECOMMENDATION</span>{issue.fix}</div><div className="issue-actions"><button>MARK REVIEWED</button><button>VIEW FILE ↗</button></div></article>)}</div></div>

      <div className="pipeline-panel" id="pipeline"><div className="section-heading compact"><div><p className="eyebrow">03 / PIPELINE</p><h2>Scan flow</h2></div><span className="running-label"><i /> {scanning ? 'RUNNING' : 'STANDBY'}</span></div><div className="pipeline">{(feed?.stages ?? fallbackStages).map((stage, index) => { const state: State = scanning && index === 4 ? 'running' : index < 5 ? 'pass' : 'pending'; return <div className={`stage stage-${state}`} key={stage}><Marker state={state} /><span>{stage}</span>{index < (feed?.stages ?? fallbackStages).length - 1 && <i className="stage-line" />}</div>; })}</div><div className="terminal"><div className="terminal-bar"><span /> <span /> <span /><b>shipcheck / scan.log</b></div><div className="terminal-lines"><p><b>$</b> shipcheck scan --local</p><p><span className="green-text">✓</span> detecting project ............ passed</p><p><span className="green-text">✓</span> checking environment ......... passed</p><p><span className="green-text">✓</span> inspecting git ............... passed</p><p><span className="amber-text">!</span> checking dependencies ........ warning</p><p><span className="green-text">✓</span> running tests ................ passed</p><p className="terminal-rule">----------------------------------------</p><p className="terminal-result">SHIP SCORE <strong>{score ?? '—'} / 100</strong></p><p>STATUS <strong className={result && result.status === 'BLOCKED' ? 'red-text' : result && result.status === 'WARNING' ? 'amber-text' : 'green-text'}>{result ? result.status : 'PENDING'}</strong></p><span className="cursor" /></div></div></div></section>

      <section className="bottom-grid" id="history"><div className="history-panel"><div className="section-heading compact"><div><p className="eyebrow">04 / HISTORY</p><h2>Scan timeline</h2></div><span className="muted-label">TODAY</span></div><div className="timeline">{timelineRows.map((row) => <div className="timeline-row" key={`${row.time}-${row.score}`}><time>{row.time}</time><strong>{row.score}<small>/100</small></strong><span className={row.statusClass}>{row.status}</span><code>{row.branch}</code><small className={row.delta === 0 ? '' : row.delta > 0 ? 'green-text' : 'red-text'}>{row.delta === 0 ? '→ 0' : row.delta > 0 ? `↑ ${row.delta}` : `↓ ${Math.abs(row.delta)}`}</small></div>)}</div></div><div className="cicd-panel"><div className="section-heading compact"><div><p className="eyebrow violet-label">05 / CI/CD</p><h2>Automation gate</h2></div><span className="violet-label">GITHUB ACTIONS</span></div><div className="automation-flow"><span>PUSH</span><i>→</i><span>SHIPCHECK</span><i>→</i><span>SCAN</span><i>→</i><strong>≥ 80<br /><b>PASS ✓</b></strong><i>→</i><span>DEPLOY</span></div><p className="cicd-note">Every push gets a readiness score before it reaches production.</p></div></section>
      <footer><span>SHIPCHECK / KNOW BEFORE YOU SHIP</span><span>ALL SYSTEMS NOMINAL <i /></span></footer>
    </div></main>
  );
}
