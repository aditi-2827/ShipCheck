'use client';

import { useEffect, useState } from 'react';
import type { Project, ScanResult } from '@/lib/types';

type State = 'pass' | 'warning' | 'critical' | 'running' | 'pending';

function Marker({ state }: { state: State }) {
  return (
    <span className={`marker marker-${state}`}>
      {state === 'pass' ? '✓' : state === 'warning' ? '!' : state === 'critical' ? '×' : state === 'running' ? '↻' : '·'}
    </span>
  );
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

function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? '' : 's'} ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffHour / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function ScoreChart({ scans }: { scans: ScanResult[] }) {
  if (scans.length === 0) return null;
  const sorted = [...scans].reverse(); // Oldest to newest left-to-right

  const width = 600;
  const height = 150;
  const paddingX = 40;
  const paddingY = 25;

  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  const minScore = 0;
  const maxScore = 100;

  const points = sorted.map((s, idx) => {
    const x = sorted.length === 1 ? width / 2 : paddingX + (idx / (sorted.length - 1)) * chartW;
    const y = height - paddingY - ((s.score - minScore) / (maxScore - minScore)) * chartH;
    return { x, y, score: s.score, id: s.id, createdAt: s.createdAt };
  });

  const pathD =
    points.length === 1
      ? ''
      : points.reduce((acc, p, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');

  const areaD =
    points.length === 1
      ? ''
      : `${pathD} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`;

  return (
    <div
      style={{
        background: 'var(--color-card, #121316)',
        border: '1px solid var(--border-color, #27272a)',
        borderRadius: '4px',
        padding: '16px 20px',
        margin: '20px 0',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span className="eyebrow" style={{ color: '#a1a1aa' }}>
          SCORE HISTORY CHART
        </span>
        <span style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: '#71717a' }}>
          {scans.length} SCAN{scans.length === 1 ? '' : 'S'} TRACKED
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {[100, 80, 60, 40].map((scoreVal) => {
          const y = height - paddingY - ((scoreVal - minScore) / (maxScore - minScore)) * chartH;
          return (
            <g key={scoreVal}>
              <line x1={paddingX} y1={y} x2={width - paddingX} y2={y} stroke="#27272a" strokeDasharray="3 3" />
              <text x={paddingX - 8} y={y + 4} fill="#71717a" fontSize="10" fontFamily="JetBrains Mono, monospace" textAnchor="end">
                {scoreVal}
              </text>
            </g>
          );
        })}
        <defs>
          <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {areaD && <path d={areaD} fill="url(#scoreGrad)" />}
        {pathD && <path d={pathD} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {points.map((p, idx) => (
          <g key={p.id || idx}>
            <circle cx={p.x} cy={p.y} r="4.5" fill="#10b981" stroke="#18181b" strokeWidth="2" />
            <text x={p.x} y={p.y - 10} fill="#f4f4f5" fontSize="11" fontWeight="600" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
              {p.score}
            </text>
            <text x={p.x} y={height - 6} fill="#71717a" fontSize="9" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
              #{idx + 1}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function groupScansByDate(scans: ScanResult[]) {
  const todayStr = new Date().toDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  const groups: { label: string; scans: ScanResult[] }[] = [];
  const map: Record<string, ScanResult[]> = {};

  for (const scan of scans) {
    const d = new Date(scan.createdAt);
    const dStr = d.toDateString();
    let groupKey = 'Earlier';
    if (dStr === todayStr) groupKey = 'Today';
    else if (dStr === yesterdayStr) groupKey = 'Yesterday';
    else groupKey = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    if (!map[groupKey]) map[groupKey] = [];
    map[groupKey].push(scan);
  }

  for (const [label, items] of Object.entries(map)) {
    groups.push({ label, scans: items });
  }

  return groups;
}

export default function ProjectDashboard({ params }: { params: { id: string } }) {
  const [filter, setFilter] = useState('all');
  const [project, setProject] = useState<Project | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${params.id}`, { credentials: 'same-origin' });
        if (!res.ok) {
          setErrorMsg(`Project not found (${params.id})`);
          return;
        }
        const body = await res.json();
        if (cancelled) return;
        if (body.ok && body.data) {
          setProject(body.data.project);
          const hist: ScanResult[] = body.data.history || [];
          setHistory(hist);
          if (hist.length > 0) {
            setSelectedScanId(hist[0].id);
          }
        } else {
          setErrorMsg(body.error?.message || 'Failed to load project details');
        }
      } catch {
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const latestScan = history[0] ?? null;
  const activeScan = history.find((s) => s.id === selectedScanId) ?? latestScan;
  const previousScan = history[1] ?? null;

  const scoreDelta = latestScan && previousScan ? latestScan.score - previousScan.score : null;

  const categories: { name: string; status: string; score: string }[] = activeScan
    ? activeScan.categories.map((c) => ({ name: c.name, status: c.status, score: c.score }))
    : [];

  const scanIssues = activeScan?.issues ?? [];
  const criticalCount = scanIssues.filter((i) => i.severity === 'critical').length;
  const warningCount = scanIssues.filter((i) => i.severity === 'warning').length;
  const infoCount = scanIssues.filter((i) => i.severity === 'info').length;
  const shownIssues = filter === 'all' ? scanIssues : scanIssues.filter((issue) => issue.severity === filter);

  const readyLabel = activeScan
    ? activeScan.status === 'READY'
      ? 'READY TO SHIP'
      : activeScan.status === 'WARNING'
        ? 'WARNING'
        : 'BLOCKED'
    : 'NO SCANS YET';

  const score = activeScan ? activeScan.score : null;
  const lastScanAgo = latestScan ? timeAgo(latestScan.createdAt) : 'no scans yet';
  const dateGroups = groupScansByDate(history);

  return (
    <main className="min-h-screen">
      <div className="shell">
        <header className="topbar">
          <a href="/" className="brand">
            <span className="brand-mark">SC</span>
            <span>SHIPCHECK</span>
            <small>PROJECT / {project?.name || params.id}</small>
          </a>
          <nav className="nav" aria-label="Primary navigation">
            {['Overview', 'History', 'Issues'].map((item, index) => (
              <a key={item} href={`#${item.toLowerCase()}`} className={index === 0 ? 'nav-active' : ''}>
                <b>0{index + 1}</b>
                {item}
              </a>
            ))}
          </nav>
          <div className="local-state">
            <i /> PROJECT DASHBOARD
          </div>
        </header>

        {errorMsg ? (
          <section className="hero">
            <div className="hero-copy">
              <h1 style={{ color: 'var(--color-critical)' }}>Project Error</h1>
              <p className="hero-lede">{errorMsg}</p>
              <a className="text-button" href="/">
                BACK TO OVERVIEW <span>↗</span>
              </a>
            </div>
          </section>
        ) : (
          <>
            {/* HERO & INSTRUMENT */}
            <section id="top" className="hero">
              <div className="hero-copy">
                <p className="eyebrow">
                  <span className="signal" /> PROJECT TRACKING / ID: {project?.id || params.id}
                </p>
                <h1>
                  <strong>{project?.name || 'PROJECT'}</strong>
                  <em> readiness</em>
                </h1>
                <p className="hero-lede">
                  Continuous health tracking for project <code>{project?.name}</code>. Run <code>shipcheck scan</code> from terminal to submit continuous assessments.
                </p>

                {/* PROJECT METADATA CARD */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginTop: '16px', background: '#121316', border: '1px solid #27272a', padding: '12px 16px', borderRadius: '4px' }}>
                  <div>
                    <span style={{ fontSize: '10px', color: '#71717a', textTransform: 'uppercase', fontFamily: 'monospace' }}>BRANCH</span>
                    <p style={{ margin: '2px 0 0', fontWeight: 600, fontSize: '13px', color: '#e4e4e7', fontFamily: 'monospace' }}>{latestScan?.env?.branch || 'n/a'}</p>
                  </div>
                  <div>
                    <span style={{ fontSize: '10px', color: '#71717a', textTransform: 'uppercase', fontFamily: 'monospace' }}>LATEST COMMIT</span>
                    <p style={{ margin: '2px 0 0', fontWeight: 600, fontSize: '13px', color: '#e4e4e7', fontFamily: 'monospace' }}>{latestScan?.env?.commit || 'n/a'}</p>
                  </div>
                  <div>
                    <span style={{ fontSize: '10px', color: '#71717a', textTransform: 'uppercase', fontFamily: 'monospace' }}>TOTAL SCANS</span>
                    <p style={{ margin: '2px 0 0', fontWeight: 600, fontSize: '13px', color: '#e4e4e7', fontFamily: 'monospace' }}>{history.length}</p>
                  </div>
                  <div>
                    <span style={{ fontSize: '10px', color: '#71717a', textTransform: 'uppercase', fontFamily: 'monospace' }}>LAST SCAN</span>
                    <p style={{ margin: '2px 0 0', fontWeight: 600, fontSize: '13px', color: '#e4e4e7', fontFamily: 'monospace' }}>{lastScanAgo}</p>
                  </div>
                </div>
              </div>

              <aside className="status-instrument">
                <div className="instrument-head">
                  <span>HEALTH INSTRUMENT</span>
                  <span className="live">
                    <i /> LIVE
                  </span>
                </div>
                <div className="ready-row">
                  <Marker state={latestScan?.status === 'READY' ? 'pass' : latestScan?.status === 'WARNING' ? 'warning' : latestScan ? 'critical' : 'pending'} />
                  <span>{readyLabel}</span>
                </div>
                <div className="instrument-meta">
                  <span>LAST SCAN</span>
                  <strong>{lastScanAgo}</strong>
                </div>
                <div className="score-big">
                  {score ?? '—'}
                  <small>/100</small>
                </div>
                {scoreDelta !== null && (
                  <div style={{ fontSize: '12px', fontFamily: 'monospace', margin: '4px 0 8px', color: scoreDelta > 0 ? '#10b981' : scoreDelta < 0 ? '#ef4444' : '#a1a1aa' }}>
                    {scoreDelta > 0 ? `↑ +${scoreDelta}` : scoreDelta < 0 ? `↓ ${scoreDelta}` : '→ 0'} from previous scan
                  </div>
                )}
                <div className="ready-label">
                  {readyLabel} <span>✓</span>
                </div>
                <div className="score-bar">
                  <span style={{ width: `${score ?? 0}%` }} />
                </div>
              </aside>
            </section>

            {/* SCORE HISTORY CHART */}
            <ScoreChart scans={history} />

            {/* OVERVIEW SECTION */}
            <section className="overview-section" id="overview">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">01 / OVERVIEW</p>
                  <h2>Deployment health</h2>
                </div>
              </div>
              <div className="health-grid">
                <div className="health-feature">
                  <div className="feature-top">
                    <div>
                      <p className="eyebrow">CURRENT SHIP SCORE</p>
                      <div className="feature-score">
                        {score ?? '—'} <small>/ 100</small>
                      </div>
                    </div>
                    <div className="ready-stamp">
                      {readyLabel} <span>✓</span>
                    </div>
                  </div>
                  <div className="segmented-bar">
                    {Array.from({ length: 10 }, (_, index) => (
                      <i key={index} />
                    ))}
                  </div>
                  <div className="feature-foot">
                    <span>
                      <b className="green-text">{activeScan ? activeScan.checksRun : '—'}</b> CHECKS PASSED
                    </span>
                    <span>
                      <b className="amber-text">{activeScan ? activeScan.warnings : '—'}</b> WARNINGS
                    </span>
                    <span>
                      <b className="red-text">{activeScan ? activeScan.blockers : '—'}</b> BLOCKERS
                    </span>
                  </div>
                </div>

                <div className="category-grid">
                  {categories.map((category) => (
                    <div className={`category ${category.status === 'critical' ? 'category-critical' : ''}`} key={category.name}>
                      <div className="category-top">
                        <p className="eyebrow">{category.name}</p>
                        <Marker state={category.status as State} />
                      </div>
                      <strong>{category.score}</strong>
                      <div className="category-state">
                        <i className={`state-dot ${category.status}`} /> <CategoryLabel status={category.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* COMPARISON CARD IF LATEST SCAN HAS COMPARISON */}
            {latestScan?.comparison && (
              <section style={{ margin: '24px 0', background: '#121316', border: '1px solid #27272a', borderRadius: '4px', padding: '16px 20px' }}>
                <div className="section-heading compact" style={{ marginBottom: '12px' }}>
                  <div>
                    <p className="eyebrow">SCAN COMPARISON</p>
                    <h3 style={{ margin: 0, fontSize: '16px', color: '#f4f4f5' }}>Changes since previous scan</h3>
                  </div>
                  <span style={{ fontSize: '12px', fontFamily: 'monospace', color: latestScan.comparison.scoreDelta >= 0 ? '#10b981' : '#ef4444' }}>
                    CHANGE: {latestScan.comparison.scoreDelta > 0 ? `+${latestScan.comparison.scoreDelta}` : latestScan.comparison.scoreDelta}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                  <div style={{ background: '#18181b', border: '1px solid #27272a', padding: '12px 14px', borderRadius: '4px' }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#10b981', fontFamily: 'monospace' }}>
                      ✓ RESOLVED ({latestScan.comparison.resolvedIssues.length})
                    </h4>
                    {latestScan.comparison.resolvedIssues.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: '#a1a1aa' }}>
                        {latestScan.comparison.resolvedIssues.map((i, idx) => (
                          <li key={idx} style={{ marginBottom: '4px' }}>
                            <strong style={{ color: '#e4e4e7' }}>{i.title}</strong> — {i.file}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: 0, fontSize: '12px', color: '#71717a' }}>No issues resolved in this scan</p>
                    )}
                  </div>
                  <div style={{ background: '#18181b', border: '1px solid #27272a', padding: '12px 14px', borderRadius: '4px' }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#f59e0b', fontFamily: 'monospace' }}>
                      ⚠ NEW / INTRODUCED ({latestScan.comparison.introducedIssues.length})
                    </h4>
                    {latestScan.comparison.introducedIssues.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: '#a1a1aa' }}>
                        {latestScan.comparison.introducedIssues.map((i, idx) => (
                          <li key={idx} style={{ marginBottom: '4px' }}>
                            <strong style={{ color: '#e4e4e7' }}>{i.title}</strong> — {i.file}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: 0, fontSize: '12px', color: '#71717a' }}>No new issues introduced</p>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* SCAN TIMELINE */}
            <section className="bottom-grid" id="history">
              <div className="history-panel" style={{ gridColumn: '1 / -1' }}>
                <div className="section-heading compact">
                  <div>
                    <p className="eyebrow">02 / HISTORY</p>
                    <h2>Scan timeline for {project?.name}</h2>
                  </div>
                  <span className="muted-label">{history.length} SCANS RECORDED</span>
                </div>

                {dateGroups.map((group) => (
                  <div key={group.label} style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #27272a', paddingBottom: '6px', marginBottom: '8px' }}>
                      {group.label}
                    </div>
                    <div className="timeline">
                      {group.scans.map((h, i) => {
                        const nextInList = history[history.indexOf(h) + 1];
                        const delta = nextInList ? h.score - nextInList.score : 0;
                        const isSelected = h.id === selectedScanId;
                        return (
                          <div
                            className="timeline-row"
                            key={h.id || i}
                            onClick={() => setSelectedScanId(h.id)}
                            style={{
                              cursor: 'pointer',
                              background: isSelected ? 'rgba(16, 185, 129, 0.08)' : undefined,
                              borderLeft: isSelected ? '3px solid #10b981' : undefined,
                              paddingLeft: isSelected ? '12px' : undefined,
                            }}
                          >
                            <time>{formatTime(h.createdAt)}</time>
                            <strong>
                              {h.score}
                              <small>/100</small>
                            </strong>
                            <span className={h.status === 'READY' ? 'green-text' : h.status === 'WARNING' ? 'amber-text' : 'red-text'}>{h.status}</span>
                            <code>{h.env?.branch ?? 'main'}</code>
                            <small className={delta === 0 ? '' : delta > 0 ? 'green-text' : 'red-text'}>
                              {delta === 0 ? '→ 0' : delta > 0 ? `↑ +${delta}` : `↓ ${delta}`}
                            </small>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {history.length === 0 && <p className="muted-label" style={{ padding: '20px' }}>No scans recorded yet for this project.</p>}
              </div>
            </section>

            {/* ISSUES EXPLORER */}
            <section className="split-section" id="issues">
              <div className="issue-panel" style={{ width: '100%' }}>
                <div className="section-heading compact">
                  <div>
                    <p className="eyebrow">03 / ISSUES</p>
                    <h2>Issue explorer ({activeScan ? `Scan #${history.length - history.indexOf(activeScan)}` : 'Latest'})</h2>
                  </div>
                  <span className="count-badge">{scanIssues.length} OPEN</span>
                </div>
                <div className="filters">
                  {[
                    ['all', 'ALL', scanIssues.length],
                    ['critical', 'CRITICAL', criticalCount],
                    ['warning', 'WARNING', warningCount],
                    ['info', 'INFO', infoCount],
                  ].map(([key, label, count]) => (
                    <button key={key} className={filter === key ? `filter-active filter-${key}` : ''} onClick={() => setFilter(String(key))}>
                      {label} <b>{count}</b>
                    </button>
                  ))}
                </div>
                <div className="issue-list">
                  {shownIssues.map((issue, idx) => (
                    <article className={`issue ${issue.severity}`} key={`${issue.title}-${idx}`}>
                      <div className="issue-severity">
                        <Marker state={issue.severity === 'critical' ? 'critical' : issue.severity === 'warning' ? 'warning' : 'pending'} /> {issue.severity.toUpperCase()}
                      </div>
                      <h3>{issue.title}</h3>
                      <code>
                        {issue.file}
                        {issue.line ? `:${issue.line}` : ''}
                      </code>
                      <p>{issue.message}</p>
                      <div className="recommendation">
                        <span>RECOMMENDATION</span>
                        {issue.fix}
                      </div>
                    </article>
                  ))}
                  {shownIssues.length === 0 && <p className="muted-label" style={{ padding: '20px' }}>No issues found in selected scan.</p>}
                </div>
              </div>
            </section>
          </>
        )}

        <footer>
          <span>SHIPCHECK / CONTINUOUS PROJECT HEALTH</span>
          <span>ALL SYSTEMS NOMINAL <i /></span>
        </footer>
      </div>
    </main>
  );
}
