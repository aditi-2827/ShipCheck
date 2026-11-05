'use client';

interface DashboardCardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function DashboardCard({ children, className, style }: DashboardCardProps) {
  return (
    <div className={`dashboard-card ${className ?? ''}`} style={style}>
      {children}
    </div>
  );
}
