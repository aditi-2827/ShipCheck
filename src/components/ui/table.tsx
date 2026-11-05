'use client';

interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
}

interface TableProps<T> {
  columns: TableColumn[];
  data: T[];
  renderCell: (row: T, column: TableColumn) => React.ReactNode;
  rowKey?: (row: T) => string | number;
}

export function Table<T>({ columns, data, renderCell, rowKey }: TableProps<T>) {
  return (
    <table className="dashboard-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} style={{ textAlign: col.align ?? 'left' }}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={rowKey ? rowKey(row) : (row as unknown as string)}>
            {columns.map((col) => (
              <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                {renderCell(row, col)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
