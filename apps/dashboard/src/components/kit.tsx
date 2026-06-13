/**
 * The in-repo component kit — small, dependency-free primitives (Card / StatRow / Table /
 * Badge / Bars). No heavyweight UI framework (Slice 10A decision §5.4). Charts are
 * hand-rolled SVG-free CSS bars; richer charts are reconsidered only if 10B/10C need them.
 */
import type { ReactNode } from 'react';

export function Card({
  title,
  full,
  children,
}: {
  title: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={full ? 'card full' : 'card'}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function Badge({ children, kind }: { children: ReactNode; kind?: 'flag' }) {
  return <span className={kind ? `badge ${kind}` : 'badge'}>{children}</span>;
}

/** A row of fixed-height bars for normalized (0..1) values — the reputation breakdown. */
export function Bars({ values }: { values: number[] }) {
  return (
    <div className="bars" title={values.map((v) => v.toFixed(2)).join(' / ')}>
      {values.map((v, i) => (
        <span key={i} style={{ height: `${Math.max(2, Math.min(1, v) * 18)}px` }} />
      ))}
    </div>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T, index: number) => ReactNode;
}

export function Table<T>({
  columns,
  rows,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  empty: string;
}) {
  return (
    <table>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.header}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="muted">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.header}>{c.cell(row, i)}</td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
