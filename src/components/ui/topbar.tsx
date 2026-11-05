'use client';

import React from 'react';

interface TopbarProps {
  breadcrumb: string[];
  children?: React.ReactNode;
}

export function Topbar({ breadcrumb, children }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        {breadcrumb.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span>/</span>}
            {part}
          </React.Fragment>
        ))}
      </div>
      <div className="topbar-actions">{children}</div>
    </header>
  );
}
