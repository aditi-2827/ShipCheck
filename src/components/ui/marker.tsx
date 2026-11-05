'use client';

type State = 'pass' | 'warning' | 'critical' | 'running' | 'pending';

interface MarkerProps {
  state: State;
}

export function Marker({ state }: MarkerProps) {
  const symbol = state === 'pass' ? '✓' : state === 'warning' ? '!' : state === 'critical' ? '×' : state === 'running' ? '↻' : '·';
  return (
    <span className={`marker marker-${state}`} aria-label={state}>
      {symbol}
    </span>
  );
}
