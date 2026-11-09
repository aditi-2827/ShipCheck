'use client';

import { useEffect, useState } from 'react';
import { getProject, initAuth, updateProjectDeployUrl, ClientApiError } from '@/lib/api';
import type { Issue, IssueGroup, Project, ScanResult } from '@/lib/types';
import {
  DashboardShell,
  DashboardCard,
  Marker,
  Badge,
  Button,
  Table,
  FilterChip,
  IssueGroupCard,
} from '@/components/ui';
import {
  formatTime,
  timeAgo,
  statusColor,
  statusLabel,
  readinessLabel,
  categoryName,
  groupIssues,
  countIssuesBySeverity,
} from '@/components/ui/utils';

function ScoreChart({ scans }: { scans: ScanResult[] }) {
  if (scans.length === 0) return null;
  const sorted = [...scans].reverse();

  const width = 600;
  const height = 150;
  const paddingX = 40;
  const paddingY = 25;

  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  const minScore = 0;
  const maxScore = 100;

  const points = sorted.map(function (s, idx) {
    const x = sorted.length === 1 ? width / 2 : paddingX + (idx / (sorted.length - 1)) * chartW;
    const y = height - paddingY - ((s.score - minScore) / (maxScore - minScore)) * chartH;
    return { x, y, score: s.score, id: s.id, createdAt: s.createdAt };
  });

  const pathD =
    points.length === 1
      ? ''
      : points.reduce(function (acc, p, idx) {
          return acc + ' ' + (idx === 0 ? 'M' : 'L') + ' ' + p.x + ' ' + p.y;
        }, '');

  const areaD =
    points.length === 1
      ? ''
      : pathD + ' L ' + points[points.length - 1].x + ' ' + (height - paddingY) + ' L ' + points[0].x + ' ' + (height - paddingY) + ' Z';

  return (
    <DashboardCard className="flex flex-col gap-3">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>SCORE HISTORY</span>
        <span style={{ fontSize: '11px', color: 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          {scans.length} SCAN{scans.length === 1 ? '' : 'S'} TRACKED
        </span>
      </div>
      <svg viewBox={'0 0 ' + width + ' ' + height} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {[100, 80, 60, 40].map(function (scoreVal) {
          const y = height - paddingY - ((scoreVal - minScore) / (maxScore - minScore)) * chartH;
          return (
            <g key={scoreVal}>
              <line x1={paddingX} y1={y} x2={width - paddingX} y2={y} stroke="var(--sc-border)" strokeDasharray="3 3" />
              <text x={paddingX - 8} y={y + 4} fill="var(--sc-text-muted)" fontSize="10" fontFamily="JetBrains Mono, monospace" textAnchor="end">
                {scoreVal}
              </text>
            </g>
          );
        })}
        <defs>
          <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--sc-success)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--sc-success)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {areaD && <path d={areaD} fill="url(#scoreGrad)" />}
        {pathD && <path d={pathD} fill="none" stroke="var(--sc-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {points.map(function (p, idx) {
          return (
            <g key={p.id || idx}>
              <circle cx={p.x} cy={p.y} r="4" fill="var(--sc-success)" stroke="var(--sc-surface)" strokeWidth="2" />
              <text x={p.x} y={p.y - 10} fill="var(--sc-text-primary)" fontSize="10" fontWeight="600" fontFamily="JetBrains Mono, monospace" textAnchor="middle">
                {p.score}
              </text>
            </g>
          );
        })}
      </svg>
    </DashboardCard>
  );
}

export default function ProjectDashboard({ params }: { params: { id: string } }) {
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [project, setProject] = useState<Project | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [deployUrl, setDeployUrl] = useState('');
  const [deployUrlDirty, setDeployUrlDirty] = useState(false);
  const [deployUrlMsg, setDeployUrlMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async function () {
      try {
        initAuth();
        const data = await getProject(params.id);
        if (cancelled) return;
        setProject(data.project);
        setDeployUrl(data.project.deployUrl ?? '');
        const hist: ScanResult[] = data.history || [];
        setHistory(hist);
        if (hist.length > 0) {
          setSelectedScanId(hist[0].id);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ClientApiError && err.status === 404) {
          setErrorMsg('Project not found (' + params.id + ')');
        } else {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load project details');
        }
      }
    })();
    return function () {
      cancelled = true;
    };
  }, [params.id]);

  async function saveDeployUrl() {
    setDeployUrlMsg('Saving…');
    try {
      const { project: updated } = await updateProjectDeployUrl(params.id, deployUrl.trim() || undefined);
      setProject(updated);
      setDeployUrlDirty(false);
      setDeployUrlMsg(updated.deployUrl ? 'Deploy URL saved. Phase 3 checks will run on the next scan.' : 'Deploy URL cleared. Phase 3 checks will render as placeholders.');
    } catch (err) {
      setDeployUrlMsg(err instanceof Error ? 'Save failed: ' + err.message : 'Save failed');
    }
  }

  const latestScan = history[0] ?? null;
  const activeScan = history.find(function (s) { return s.id === selectedScanId; }) ?? latestScan;
  const previousScan = history[1] ?? null;

  const scoreDelta = latestScan && previousScan ? latestScan.score - previousScan.score : null;

  const score = activeScan ? activeScan.score : null;
  const readyLabel = readinessLabel(activeScan?.status ?? null);
  const lastScanAgo = latestScan ? timeAgo(latestScan.createdAt) : 'no scans yet';

  const categories = activeScan
    ? activeScan.categories.map(function (c) { return { slug: c.slug, name: c.name, status: c.status, score: c.score }; })
    : [];

  const badgeStatus = score !== null && score >= 80 ? 'pass' : score !== null && score >= 60 ? 'warning' : 'critical';

  const deltaColor = scoreDelta !== null && scoreDelta > 0 ? 'var(--sc-success)' : scoreDelta !== null && scoreDelta < 0 ? 'var(--sc-danger)' : 'var(--sc-text-muted)';
  const deltaText = scoreDelta !== null && scoreDelta > 0 ? '↑ +' + scoreDelta : scoreDelta !== null && scoreDelta < 0 ? '↓ ' + Math.abs(scoreDelta) : '→ 0';

  const scanIssues = activeScan?.issues ?? [];
  const criticalCount = scanIssues.filter(function (i) { return i.severity === 'critical'; }).length;
  const warningCount = scanIssues.filter(function (i) { return i.severity === 'warning'; }).length;
  const infoCount = scanIssues.filter(function (i) { return i.severity === 'info'; }).length;
  const shownIssues = filter === 'all' ? scanIssues : scanIssues.filter(function (issue) { return issue.severity === filter; });

  const projectName = project?.name || params.id;
  const topbarActions = (
    <Button variant="secondary" onClick={function () { setDeployUrlDirty(!deployUrlDirty); }} size="sm">
      {deployUrlDirty ? 'Cancel' : 'Deploy URL'}
    </Button>
  );

  const compDelta = latestScan?.comparison?.scoreDelta ?? 0;
  const comparisonDeltaColor = compDelta >= 0 ? 'var(--sc-success)' : 'var(--sc-danger)';
  const comparisonDeltaText = compDelta > 0 ? '+' + compDelta : compDelta.toString();

  return (
    <DashboardShell
      breadcrumb={['ShipCheck', projectName]}
      topbarActions={topbarActions}
    >
      {errorMsg ? (
        <section className="section">
          <DashboardCard>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '24px' }}>
              <h1 style={{ color: 'var(--sc-danger)', fontSize: '20px', margin: 0, fontWeight: '600' }}>Project Error</h1>
              <p style={{ color: 'var(--sc-text-secondary)', fontSize: '13px', fontFamily: 'JetBrains Mono, monospace' }}>{errorMsg}</p>
              <Button variant="secondary" size="sm" onClick={function () { window.location.href = '/'; }}>Back to Overview</Button>
            </div>
          </DashboardCard>
        </section>
      ) : (
        <div>
          <section className="section">
            <div className="page-header">
              <h1 className="page-title">{projectName}</h1>
              <p className="page-description">Continuous health tracking for project <code style={{ color: 'var(--sc-accent)', fontSize: '13px' }}>{projectName}</code>.</p>
            </div>

            <div className="grid grid-cols-4" style={{ marginBottom: '20px' }}>
              <DashboardCard className="flex flex-col gap-3">
                <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>SHIP SCORE</span>
                <span style={{ fontSize: '34px', fontWeight: '600', color: 'var(--sc-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{score ?? '—'}</span>
                <span style={{ fontSize: '16px', color: 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}> / 100</span>
                <Badge status={badgeStatus}>{readyLabel}</Badge>
              </DashboardCard>
              <DashboardCard className="flex flex-col gap-3">
                <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>LAST SCAN</span>
                <span style={{ fontSize: '14px', color: 'var(--sc-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{lastScanAgo}</span>
                {scoreDelta !== null && (
                  <span style={{ fontSize: '12px', fontWeight: '600', color: deltaColor, fontFamily: 'JetBrains Mono, monospace' }}>
                    {deltaText}
                  </span>
                )}
              </DashboardCard>
              <DashboardCard className="flex flex-col gap-3">
                <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>TOTAL SCANS</span>
                <span style={{ fontSize: '34px', fontWeight: '600', color: 'var(--sc-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{history.length}</span>
              </DashboardCard>
              <DashboardCard className="flex flex-col gap-3">
                <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>PHASE 3</span>
                <span style={{ fontSize: '14px', fontWeight: '600', color: project?.deployUrl ? 'var(--sc-success)' : 'var(--sc-warning)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {project?.deployUrl ? 'ENABLED' : 'DISABLED'}
                </span>
              </DashboardCard>
            </div>

            <DashboardCard className="flex flex-col gap-4">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>BRANCH</span>
                  <p style={{ margin: '4px 0 0', fontSize: '14px', fontWeight: '600', color: 'var(--sc-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{latestScan?.env?.branch || 'n/a'}</p>
                </div>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>LATEST COMMIT</span>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', fontWeight: '600', color: 'var(--sc-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{latestScan?.env?.commit || 'n/a'}</p>
                </div>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>DEPLOY URL</span>
                  <p style={{ margin: '4px 0 0', fontSize: '12px', fontWeight: '600', color: project?.deployUrl ? 'var(--sc-accent)' : 'var(--sc-text-secondary)', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }} title={project?.deployUrl ?? ''}>
                    {project?.deployUrl ?? 'not set — phase 3 disabled'}
                  </p>
                </div>
              </div>
              <div style={{ paddingTop: '12px', borderTop: '1px solid var(--sc-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>DEPLOY URL SETTINGS</span>
                  <Badge status={project?.deployUrl ? 'pass' : 'warning'}>{project?.deployUrl ? 'ENABLED' : 'DISABLED'}</Badge>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="url"
                    placeholder="https://your-app.example.com"
                    value={deployUrl}
                    onChange={function (e) {
                      setDeployUrl(e.target.value);
                      setDeployUrlDirty(true);
                      setDeployUrlMsg('');
                    }}
                    className="input"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={saveDeployUrl}
                    disabled={!deployUrlDirty}
                  >
                    SAVE
                  </Button>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--sc-text-secondary)', lineHeight: 1.5 }}>
                  Setting a live URL here enables the API Check, Post-Deployment and Lighthouse (Performance) checks on the next scan. Leave blank to use pass-status placeholders.
                </p>
                {deployUrlMsg && (
                  <p style={{ margin: '8px 0 0', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--sc-accent)' }}>{deployUrlMsg}</p>
                )}
              </div>
            </DashboardCard>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <ScoreChart scans={history} />

                <DashboardCard className="flex flex-col gap-4">
                  <div className="section-header">
                    <h2 className="section-title">Readiness checks</h2>
                  </div>
                  <div className="grid grid-cols-2">
                    {categories.map(function (category) {
                      return (
                        <DashboardCard key={category.slug} className="flex flex-col gap-2 p-3" style={{ background: 'transparent', border: '1px solid var(--sc-border)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '11px', color: 'var(--sc-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>{categoryName(category.slug)}</span>
                            <Marker state={category.status} />
                          </div>
                          <div style={{ fontSize: '18px', fontWeight: '600', color: 'var(--sc-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{category.score}</div>
                          <Badge status={category.status}>{statusLabel(category.status)}</Badge>
                        </DashboardCard>
                      );
                    })}
                  </div>
                </DashboardCard>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {latestScan?.comparison && (
                  <DashboardCard className="flex flex-col gap-3">
                    <div className="section-header">
                      <h2 className="section-title">Scan comparison</h2>
                      <span style={{ fontSize: '11px', color: comparisonDeltaColor, fontWeight: '600', fontFamily: 'JetBrains Mono, monospace' }}>
                        {comparisonDeltaText}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div style={{ background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: '6px', padding: '12px' }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-success)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Resolved ({latestScan.comparison.resolvedIssues.length})</div>
                        {latestScan.comparison.resolvedIssues.length > 0 ? (
                          <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: 'var(--sc-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                            {latestScan.comparison.resolvedIssues.map(function (i, idx) {
                              return (
                                <li key={idx} style={{ marginBottom: '4px' }}>
                                  <span style={{ color: 'var(--sc-text-primary)' }}>{i.title}</span> — {i.file}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p style={{ margin: 0, fontSize: '12px', color: 'var(--sc-text-muted)' }}>No issues resolved</p>
                        )}
                      </div>
                      <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', padding: '12px' }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-danger)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Introduced ({latestScan.comparison.introducedIssues.length})</div>
                        {latestScan.comparison.introducedIssues.length > 0 ? (
                          <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: 'var(--sc-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                            {latestScan.comparison.introducedIssues.map(function (i, idx) {
                              return (
                                <li key={idx} style={{ marginBottom: '4px' }}>
                                  <span style={{ color: 'var(--sc-text-primary)' }}>{i.title}</span> — {i.file}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p style={{ margin: 0, fontSize: '12px', color: 'var(--sc-text-muted)' }}>No new issues</p>
                        )}
                      </div>
                    </div>
                  </DashboardCard>
                )}

                <DashboardCard className="flex flex-col gap-3">
                  <div className="section-header">
                    <h2 className="section-title">Scan timeline</h2>
                    <span style={{ fontSize: '11px', color: 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{history.length} scans recorded</span>
                  </div>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {history.map(function (h, i) {
                      const nextInList = history[i + 1];
                      const delta = nextInList ? h.score - nextInList.score : 0;
                      const isSelected = h.id === selectedScanId;
                      const timelineDeltaColor = delta === 0 ? 'var(--sc-text-muted)' : delta > 0 ? 'var(--sc-success)' : 'var(--sc-danger)';
                      const timelineDeltaText = delta === 0 ? '→ 0' : delta > 0 ? '↑ +' + delta : '↓ ' + Math.abs(delta);
                      return (
                        <div
                          key={h.id || i}
                          onClick={function () { setSelectedScanId(h.id); }}
                          style={{
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 12px',
                            borderBottom: '1px solid var(--sc-border)',
                            background: isSelected ? 'rgba(56, 189, 248, 0.08)' : undefined,
                            borderLeft: isSelected ? '3px solid var(--sc-accent)' : undefined,
                            transition: 'background 0.2s ease',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '120px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{formatTime(h.createdAt)}</span>
                            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--sc-text-primary)', fontFamily: 'JetBrains Mono, monospace', fontVariantNumeric: 'tabular-nums' }}>
                              {h.score}
                              <span style={{ fontSize: '11px', color: 'var(--sc-text-muted)', marginLeft: '4px' }}> / 100</span>
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '140px' }}>
                            <span style={{ color: h.status === 'READY' ? 'var(--sc-success)' : h.status === 'WARNING' ? 'var(--sc-warning)' : 'var(--sc-danger)', fontSize: '11px', fontWeight: '600', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>{h.status}</span>
                            <span style={{ fontSize: '12px', color: 'var(--sc-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>{h.env?.branch ?? 'main'}</span>
                            <span style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: timelineDeltaColor }}>
                              {timelineDeltaText}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {history.length === 0 && (
                      <p style={{ color: 'var(--sc-text-muted)', fontSize: '13px', padding: '24px', textAlign: 'center' }}>No scans recorded yet for this project.</p>
                    )}
                  </div>
                </DashboardCard>
              </div>
            </div>

            <DashboardCard className="flex flex-col gap-3">
              <div className="section-header">
                <h2 className="section-title">Issue explorer</h2>
                <span style={{ fontSize: '11px', color: 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{scanIssues.length} open</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                {[
                  { key: 'all', label: 'ALL', count: scanIssues.length },
                  { key: 'critical', label: 'CRITICAL', count: criticalCount },
                  { key: 'warning', label: 'WARNING', count: warningCount },
                  { key: 'info', label: 'INFO', count: infoCount },
                ].map(function (item) {
                  return (
                    <FilterChip
                      key={item.key}
                      label={item.label}
                      count={item.count}
                      active={filter === item.key}
                      onSelect={function (k: string) { setFilter(k as 'all' | 'critical' | 'warning' | 'info'); }}
                    />
                  );
                })}
              </div>
              <Table<Issue>
                columns={[
                  { key: 'severity', label: 'SEVERITY', align: 'left' },
                  { key: 'title', label: 'ISSUE', align: 'left' },
                  { key: 'file', label: 'FILE', align: 'left' },
                  { key: 'fix', label: 'RECOMMENDATION', align: 'left' },
                ]}
                data={shownIssues}
                rowKey={function (i: Issue) { return i.title; }}
                renderCell={function (issue: Issue, column) {
                  switch (column.key) {
                    case 'severity': {
                      const sev = issue.severity as 'pass' | 'warning' | 'critical' | 'running' | 'pending';
                      return (
                        <span style={{ color: statusColor(sev), fontWeight: '600', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>
                          {issue.severity.toUpperCase()}
                        </span>
                      );
                    }
                    case 'title':
                      return <span style={{ fontSize: '13px', color: 'var(--sc-text-primary)' }}>{issue.title}</span>;
                    case 'file':
                      return (
                        <span style={{ fontSize: '12px', color: 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                          {issue.file}{issue.line ? ':' + issue.line : ''}
                        </span>
                      );
                    case 'fix':
                      return (
                        <span style={{ fontSize: '12px', color: 'var(--sc-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>{issue.fix}</span>
                      );
                    default:
                      return null;
                  }
                }}
              />
              {shownIssues.length === 0 && (
                <p style={{ color: 'var(--sc-text-muted)', fontSize: '13px', padding: '24px', textAlign: 'center' }}>No issues found in selected scan.</p>
              )}
            </DashboardCard>
          </section>
        </div>
      )}
    </DashboardShell>
  );
}
