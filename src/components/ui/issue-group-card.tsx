'use client';

import type { IssueGroup } from '@/lib/types';
import { Marker } from './marker';
import { statusColor } from './utils';

interface IssueGroupCardProps {
  group: IssueGroup;
  expanded: boolean;
  onToggle: () => void;
}

export function IssueGroupCard({ group, expanded, onToggle }: IssueGroupCardProps) {
  const uniqueFiles = Array.from(new Set(group.occurrences.map(function (o) { return o.file; }))).filter(function (f) { return f !== null; });
  const severityColor = statusColor(group.severity as 'pass' | 'warning' | 'critical' | 'running' | 'pending');

  return (
    <div style={{ border: '1px solid var(--sc-border)', borderRadius: '6px', background: 'var(--sc-surface)', marginBottom: '10px', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          cursor: 'pointer',
          background: expanded ? 'var(--sc-surface-hover)' : 'transparent',
          borderBottom: expanded ? '1px solid var(--sc-border)' : 'none',
        }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
          <Marker state={group.severity as 'pass' | 'warning' | 'critical' | 'running' | 'pending'} />
          <div>
            <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--sc-text-primary)' }}>{group.title}</div>
            <div style={{ fontSize: '11px', color: severityColor, fontWeight: '600', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', marginTop: '2px' }}>
              {group.severity.toUpperCase()}
            </div>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {group.count} occurrence{group.count !== 1 ? 's' : ''} • {uniqueFiles.length} file{uniqueFiles.length !== 1 ? 's' : ''}
          </div>
        </div>
        <span style={{ fontSize: '10px', color: 'var(--sc-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          {expanded ? '▲ collapse' : '▼ expand'}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px 16px' }}>
          <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>DESCRIPTION</div>
          <p style={{ fontSize: '13px', color: 'var(--sc-text-secondary)', margin: '0 0 12px 0', fontFamily: 'JetBrains Mono, monospace' }}>{group.message}</p>

          <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>RECOMMENDATION</div>
          <div style={{ padding: '10px 12px', background: 'var(--sc-surface-hover)', border: '1px solid var(--sc-border)', borderRadius: '6px', fontSize: '13px', color: 'var(--sc-text-primary)', fontFamily: 'JetBrains Mono, monospace', marginBottom: '12px' }}>
            {group.fix}
          </div>

          <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>OCCURRENCES ({group.count})</div>
          <div style={{ display: 'grid', gap: '6px' }}>
            {group.occurrences.map(function (occ, idx) {
              const fileLabel = occ.file ?? 'unknown';
              const lineLabel = occ.line !== null ? ':' + occ.line : '';
              return (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', borderRadius: '4px', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' }}>
                  <span style={{ color: 'var(--sc-text-secondary)' }}>{fileLabel}</span>
                  <span style={{ color: 'var(--sc-text-primary)', fontWeight: '600' }}>{lineLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
