'use client';

interface FilterChipProps {
  key: string;
  label: string;
  count: number;
  active: boolean;
  onSelect: (k: string) => void;
}

export function FilterChip({ key, label, count, active, onSelect }: FilterChipProps) {
  return (
    <button
      className={active ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
      onClick={() => onSelect(key)}
    >
      {label}
      <span style={{ fontWeight: '400', marginLeft: '6px' }}>{count}</span>
    </button>
  );
}
