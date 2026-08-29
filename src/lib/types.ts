export type Severity = 'critical' | 'warning' | 'info';
export type CheckStatus = 'pass' | 'warning' | 'critical' | 'running' | 'pending';

export interface Issue {
  severity: Severity;
  title: string;
  file: string | null;
  line: number | null;
  message: string;
  fix: string;
}

export interface CategoryResult {
  slug: string;
  name: string;
  status: CheckStatus;
  score: string; // e.g. "18/18"
  childChecks: CheckSummary[];
}

export interface CheckSummary {
  slug: string;
  name: string;
  status: Exclude<CheckStatus, 'running' | 'pending'>;
  detail: string;
}

export interface ScanResult {
  id: string;
  createdAt: string; // ISO timestamp, UTC
  score: number; // 0-100
  status: 'READY' | 'BLOCKED' | 'WARNING';
  categories: CategoryResult[];
  issues: Issue[];
  checksRun: number;
  warnings: number;
  blockers: number;
  env: {
    node: string;
    npm: string;
    commit: string;
    branch: string;
    durationMs: number;
  };
}

export interface FeedCategory {
  slug: string;
  name: string;
}

export interface FeedData {
  schemaVersion: number;
  categories: FeedCategory[];
  stages: string[];
  thresholds: {
    ready: number;
    warning: number;
  };
}
