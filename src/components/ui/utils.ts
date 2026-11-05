export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso: string): string {
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

export function statusColor(status: 'pass' | 'warning' | 'critical' | 'running' | 'pending'): string {
  switch (status) {
    case 'pass': return 'var(--sc-success)';
    case 'warning': return 'var(--sc-warning)';
    case 'critical': return 'var(--sc-danger)';
    case 'running': return 'var(--sc-accent)';
    case 'pending': return 'var(--sc-text-muted)';
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'pass': return 'HEALTHY';
    case 'critical': return 'CRITICAL';
    case 'pending': return 'PENDING';
    default: return 'WARNING';
  }
}

export function readinessLabel(status: 'READY' | 'WARNING' | 'BLOCKED' | null): string {
  if (!status) return 'PENDING';
  switch (status) {
    case 'READY': return 'READY TO SHIP';
    case 'WARNING': return 'WARNING';
    case 'BLOCKED': return 'BLOCKED';
  }
}

export function categoryName(slug: string): string {
  const map: Record<string, string> = {
    security: 'Security',
    build: 'Build',
    tests: 'Tests',
    code_quality: 'Code Quality',
    api_check: 'API Check',
    deployment: 'Deployment',
    dependencies: 'Dependencies',
    post_deployment: 'Post-Deploy',
    performance: 'Performance',
    monitoring: 'Monitoring',
    database: 'Database',
    git: 'Git',
    ci_cd: 'CI/CD',
    docker: 'Docker',
    rollback: 'Rollback',
    environment: 'Environment',
  };
  return map[slug] || slug;
}
