'use client';

import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

interface DashboardShellProps {
  breadcrumb: string[];
  children: React.ReactNode;
  topbarActions?: React.ReactNode;
}

export function DashboardShell({ breadcrumb, children, topbarActions }: DashboardShellProps) {
  return (
    <div className="dashboard-shell">
      <Sidebar />
      <div className="dashboard-main">
        <Topbar breadcrumb={breadcrumb}>{topbarActions}</Topbar>
        <div className="page-content">{children}</div>
      </div>
    </div>
  );
}
