'use client';

interface BadgeProps {
  status: 'pass' | 'warning' | 'critical' | 'running' | 'pending';
  children?: React.ReactNode;
}

export function Badge({ status, children }: BadgeProps) {
  return (
    <span className={`badge badge-${status}`}>
      {children}
    </span>
  );
}
