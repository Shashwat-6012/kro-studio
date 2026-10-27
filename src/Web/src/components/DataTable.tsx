import type { CSSProperties, ReactNode } from 'react';
import { EmptyState, LoadingState } from './EmptyState';

export type Column<T> = {
  key: string;
  header: string;
  width: string;
  render: (row: T) => ReactNode;
  hideOnSmall?: boolean;
  align?: 'right';
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  loadingTitle?: string;
  empty: ReactNode;
  footer?: ReactNode;
};

export function DataTable<T>({ columns, rows, rowKey, onRowClick, loading, loadingTitle = 'Loading…', empty, footer }: Props<T>) {
  const style = {
    '--cols': columns.map((c) => c.width).join(' '),
    '--cols-sm': columns.filter((c) => !c.hideOnSmall).map((c) => c.width).join(' '),
  } as CSSProperties;
  const cell = (column: Column<T>) => `cell ${column.hideOnSmall ? 'cell--hide-sm' : ''} ${column.align === 'right' ? 'cell--right' : ''}`;

  return (
    <div className="table-card" style={style} role="table">
      <div className="table-head" role="row">{columns.map((c) => <span key={c.key} role="columnheader" className={cell(c)}>{c.header}</span>)}</div>
      {loading ? <LoadingState title={loadingTitle} /> : rows.length === 0 ? empty : rows.map((row) => (
        <div
          key={rowKey(row)}
          role="row"
          className={`table-row ${onRowClick ? 'is-clickable' : ''}`}
          tabIndex={onRowClick ? 0 : undefined}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={onRowClick ? (event) => { if (event.key === 'Enter' && event.target === event.currentTarget) onRowClick(row); } : undefined}
        >
          {columns.map((c) => <span key={c.key} role="cell" className={cell(c)}>{c.render(row)}</span>)}
        </div>
      ))}
      {footer && <div className="table-footer">{footer}</div>}
    </div>
  );
}

export { EmptyState };
