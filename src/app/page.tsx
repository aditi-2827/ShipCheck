'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFeed, getHistory, runScan as apiRunScan, initAuth, ClientApiError } from '@/lib/api';
import type { FeedData, Issue, ScanResult } from '@/lib/types';
import {
  DashboardShell,
  DashboardCard,
  Marker,
  Badge,
  Button,
  Table,
  FilterChip,
} from '@/components/ui';
import {
  formatTime,
  statusColor,
  statusLabel,
  readinessLabel,
  categoryName,
} from '@/components/ui/utils';

const fallbackStages = ['Discover', 'Config', 'Git', 'Dependencies', 'Tests', 'Build', 'Docker', 'Security', 'Ship'];

type State = 'pass' | 'warning' | 'critical' | 'running' | 'pending';

export default function Home() {
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [scanning, setScanning] = useState(false);
  const [feed, setFeed] = useState<FeedData | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        initAuth();
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

  const categories = result
    ? result.categories.map((c) => ({ slug: c.slug, name: c.name, status: c.status, score: c.score }))
    : (feed?.categories ?? []).map((c) => ({ slug: c.slug, name: c.name, status: 'pending' as State, score: '—' }));

  const scanIssues = result?.issues ?? [];
  const criticalCount = scanIssues.filter((i) => i.severity === 'critical').length;
  const warningCount = scanIssues.filter((i) => i.severity === 'warning').length;
  const infoCount = scanIssues.filter((i) => i.severity === 'info').length;
  const shownIssues = filter === 'all' ? scanIssues : scanIssues.filter((issue) => issue.severity === filter);

  const readyLabel = readinessLabel(result?.status ?? null);
  const score = result ? result.score : null;
  const lastScanLabel = scanning ? 'SCANNING…' : result ? formatTime(result.createdAt) : 'NO SCAN YET';
  const progressColor = score !== null && score >= 80 ? 'var(--sc-success)' : score !== null && score >= 60 ? 'var(--sc-warning)' : 'var(--sc-danger)';

  const timelineRows = history.map((h, i) => {
    const prev = history[i + 1];
    const delta = prev ? h.score - prev.score : 0;
    return {
      time: formatTime(h.createdAt),
      score: h.score,
      status: h.status,
      branch: h.env?.branch ?? 'n/a',
      delta,
    };
  });

  const topbarActions = (
    <Button variant="primary" onClick={runScan} disabled={scanning} size="sm">
      {scanning ? '↻ SCANNING…' : '▶ RUN SCAN'}
    </Button>
  );

  return (
    <DashboardShell
      breadcrumb={['ShipCheck', 'Overview']}
      topbarActions={topbarActions}
    >
      <section className="section">
        <div className="page-header">
          <h1 className="page-title">Overview</h1>
          <p className="page-description">Monitor your project&apos;s deployment readiness with weighted category scores.</p>
        </div>
        {errorMsg && (
          <DashboardCard className="mb-6">
            <div style={{ color: 'var(--sc-danger)', fontSize: '13px', fontFamily: 'JetBrains Mono, monospace', padding: '12px 16px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px' }}>
              {errorMsg}
            </div>
          </DashboardCard>
        )}
        <div className="grid grid-cols-2">
          <DashboardCard className="flex flex-col gap-4">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: '56px', fontWeight: '600', color: 'var(--sc-text-primary)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
                {score ?? '—'}
              </span>
              <span style={{ fontSize: '16px', color: 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}> / 100</span>
            </div>
            <p style={{ color: 'var(--sc-text-secondary)', fontSize: '13px', fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
              {readyLabel}
            </p>
            <div style={{ height: '6px', background: 'var(--sc-border)', borderRadius: '3px', overflow: 'hidden', marginTop: '8px' }}>
              <div
                style={{
                  height: '100%',
                  width: `${score ?? 0}%`,
                  background: progressColor,
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '10px' }}>
              <span>{result ? result.checksRun : '—'} checks passed</span>
              <span>{result ? result.warnings : '—'} warnings</span>
              <span>{result ? result.blockers : '—'} blockers</span>
            </div>
          </DashboardCard>
          <DashboardCard className="flex flex-col gap-3">
            <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>SCAN SUMMARY</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--sc-surface-hover)', border: '1px solid var(--sc-border)', borderRadius: '6px', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', color: 'var(--sc-text-secondary)' }}>Passed</span>
              <Badge status="pass">{result ? result.checksRun : '—'}</Badge>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--sc-surface-hover)', border: '1px solid var(--sc-border)', borderRadius: '6px', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', color: 'var(--sc-text-secondary)' }}>Warnings</span>
              <Badge status="warning">{warningCount}</Badge>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--sc-surface-hover)', border: '1px solid var(--sc-border)', borderRadius: '6px' }}>
              <span style={{ fontSize: '13px', color: 'var(--sc-text-secondary)' }}>Blockers</span>
              <Badge status="critical">{criticalCount}</Badge>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--sc-surface-hover)', border: '1px solid var(--sc-border)', borderRadius: '6px' }}>
              <span style={{ fontSize: '13px', color: 'var(--sc-text-secondary)' }}>Last scan</span>
              <span style={{ fontSize: '13px', color: 'var(--sc-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{lastScanLabel}</span>
            </div>
          </DashboardCard>
        </div>

        <div className="grid grid-cols-4">
          {categories.map((category) => (
            <DashboardCard key={category.slug} className="flex flex-col gap-3">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', color: 'var(--sc-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>{categoryName(category.slug)}</span>
                <Marker state={category.status} />
              </div>
              <div style={{ fontSize: '20px', fontWeight: '600', color: 'var(--sc-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{category.score}</div>
              <Badge status={category.status}>{statusLabel(category.status)}</Badge>
            </DashboardCard>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Issues requiring attention</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
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
        </div>
        <DashboardCard>
          <Table<Issue>
            columns={[
              { key: 'severity', label: 'SEVERITY', align: 'left' },
              { key: 'title', label: 'ISSUE', align: 'left' },
              { key: 'file', label: 'FILE', align: 'left' },
              { key: 'status', label: 'STATUS', align: 'left' },
            ]}
            data={shownIssues}
            rowKey={(i: Issue) => i.title}
            renderCell={(issue: Issue, column) => {
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
                      {issue.file}{issue.line ? `:${issue.line}` : ''}
                    </span>
                  );
                case 'status':
                  return <span style={{ fontSize: '11px', color: 'var(--sc-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>Open</span>;
                default:
                  return null;
              }
            }}
          />
          {shownIssues.length === 0 && (
            <p style={{ color: 'var(--sc-text-muted)', fontSize: '13px', padding: '24px', textAlign: 'center' }}>No issues found.</p>
          )}
        </DashboardCard>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Scan pipeline</h2>
          </div>
          <span style={{ fontSize: '11px', color: scanning ? 'var(--sc-accent)' : 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {scanning ? '● RUNNING' : '○ STANDBY'}
          </span>
        </div>
        <DashboardCard className="flex flex-col gap-4">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {(feed?.stages ?? fallbackStages).map((stage, index) => (
              <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Marker state={scanning && index === 4 ? 'running' : index < 5 ? 'pass' : 'pending'} />
                <span style={{ fontSize: '12px', color: 'var(--sc-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>{stage}</span>
                {index < (feed?.stages ?? fallbackStages).length - 1 && (
                  <span style={{ fontSize: '10px', color: 'var(--sc-text-muted)' }}>/</span>
                )}
              </div>
            ))}
          </div>
          <div style={{ background: '#0a0a0b', border: '1px solid var(--sc-border)', borderRadius: '6px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--sc-border)', background: 'rgba(255,255,255,0.03)' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f56', display: 'inline-block', marginRight: '6px' }} />
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e', display: 'inline-block', marginRight: '6px' }} />
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#27c93f', display: 'inline-block', marginRight: '10px' }} />
              <b style={{ fontSize: '12px', color: 'var(--sc-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>shipcheck / scan.log</b>
            </div>
            <div style={{ padding: '12px', fontSize: '12px', lineHeight: '1.6', fontFamily: 'JetBrains Mono, monospace', color: 'var(--sc-text-secondary)', overflowX: 'auto', maxHeight: '300px', overflowY: 'auto' }}>
              <p><span style={{ color: 'var(--sc-text-muted)' }}>❯</span> shipcheck scan --local</p>
              <p><span style={{ color: 'var(--sc-success)' }}>✓</span> detecting project ........................ passed</p>
              <p><span style={{ color: 'var(--sc-success)' }}>✓</span> checking environment ....................... passed</p>
              <p><span style={{ color: 'var(--sc-success)' }}>✓</span> inspecting git ............................... passed</p>
              <p><span style={{ color: 'var(--sc-warning)' }}>!</span> checking dependencies ...................... warning</p>
              <p><span style={{ color: 'var(--sc-success)' }}>✓</span> running tests .................................. passed</p>
              <p style={{ borderTop: '1px solid var(--sc-border)', paddingTop: '8px', marginTop: '8px', color: 'var(--sc-text-secondary)' }}>
                SHIP SCORE <strong style={{ color: 'var(--sc-text-primary)' }}>{score ?? '—'} / 100</strong>
              </p>
              <p style={{ color: 'var(--sc-text-secondary)' }}>
                STATUS{' '}
                <strong style={{ color: result?.status === 'BLOCKED' ? 'var(--sc-danger)' : result?.status === 'WARNING' ? 'var(--sc-warning)' : 'var(--sc-success)' }}>
                  {result ? result.status : 'PENDING'}
                </strong>
              </p>
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--sc-text-primary)', animation: 'sc-blink 1s infinite', marginRight: '6px' }} />
            </div>
          </div>
        </DashboardCard>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2 className="section-title">Recent scan activity</h2>
          </div>
        </div>
        <DashboardCard>
          <Table<{ time: string; score: number; status: string; branch: string; delta: number }>
            columns={[
              { key: 'time', label: 'TIME', align: 'left' },
              { key: 'score', label: 'SCORE', align: 'right' },
              { key: 'status', label: 'STATUS', align: 'left' },
              { key: 'branch', label: 'BRANCH', align: 'left' },
              { key: 'delta', label: 'DELTA', align: 'right' },
            ]}
            data={timelineRows}
            rowKey={(r) => `${r.time}-${r.score}`}
            renderCell={(row, column) => {
              switch (column.key) {
                case 'time':
                  return <span style={{ fontSize: '12px', color: 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{row.time}</span>;
                case 'score':
                  return (
                    <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--sc-text-primary)', fontFamily: 'JetBrains Mono, monospace', fontVariantNumeric: 'tabular-nums' }}>
                      {row.score}
                      <span style={{ fontSize: '11px', color: 'var(--sc-text-muted)', marginLeft: '4px' }}> / 100</span>
                    </span>
                  );
                case 'status':
                  return (
                    <span style={{ color: result?.status === 'BLOCKED' ? 'var(--sc-danger)' : result?.status === 'WARNING' ? 'var(--sc-warning)' : 'var(--sc-success)', fontSize: '11px', fontWeight: '600', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>
                      {row.status}
                    </span>
                  );
                case 'branch':
                  return (
                    <span style={{ fontSize: '12px', color: 'var(--sc-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>{row.branch}</span>
                  );
                case 'delta':
                  return (
                    <span style={{ fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', color: row.delta === 0 ? 'var(--sc-text-muted)' : row.delta > 0 ? 'var(--sc-success)' : 'var(--sc-danger)', fontWeight: '500' }}>
                      {row.delta === 0 ? '→ 0' : row.delta > 0 ? `↑ ${row.delta}` : `↓ ${Math.abs(row.delta)}`}
                    </span>
                  );
                default:
                  return null;
              }
            }}
          />
          {timelineRows.length === 0 && (
            <p style={{ color: 'var(--sc-text-muted)', fontSize: '13px', padding: '24px', textAlign: 'center' }}>No scans recorded yet.</p>
          )}
        </DashboardCard>
      </section>
    </DashboardShell>
  );
}
