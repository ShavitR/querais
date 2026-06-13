/**
 * Admin review queue (Slice 10C) — the human side of the manual-review loop (Slices 5/8).
 * Gated by the operator's `x-admin-token` (kept in sessionStorage, never persisted to disk).
 * Each flag shows the Layer-A verdicts behind it (similarity + verdict — hashes/scores only,
 * never prompt text) and a one-click mark-reviewed. Raising a dispute is 10C-2.
 */
import { useState } from 'react';
import { getAdminFlags, reviewFlag } from '../api/client';
import type { AdminFlag } from '../api/types';
import { Badge, Card, Table } from '../components/kit';
import type { Column } from '../components/kit';
import { fmtTime, shortAddr } from '../lib/format';

const TOKEN_KEY = 'querais_admin_token';

export function Admin() {
  const [token, setToken] = useState<string>(() => sessionStorage.getItem(TOKEN_KEY) ?? '');
  const [flags, setFlags] = useState<AdminFlag[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [reviewer, setReviewer] = useState('admin');
  const [error, setError] = useState<string | null>(null);

  const load = async (tok = token, st = status) => {
    setError(null);
    try {
      const res = await getAdminFlags(tok, st);
      setFlags(res.flags);
      setOpenCount(res.openCount);
      sessionStorage.setItem(TOKEN_KEY, tok);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
      setFlags(null);
    }
  };

  const review = async (id: number) => {
    setError(null);
    try {
      await reviewFlag(token, id, reviewer.trim() || 'admin');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to review');
    }
  };

  if (flags === null) {
    return (
      <main>
        <Card title="Admin review queue" full>
          <div className="muted" style={{ marginBottom: 8 }}>
            Paste the operator's admin token to load the manual-review queue.
          </div>
          <div className="row">
            <input
              type="password"
              placeholder="admin token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load();
              }}
            />
            <button onClick={() => void load()}>load</button>
          </div>
          {error ? (
            <div className="error" style={{ marginTop: 8 }}>
              {error}
            </div>
          ) : null}
        </Card>
      </main>
    );
  }

  const columns: Column<AdminFlag>[] = [
    { header: 'when', cell: (f) => <span className="muted">{fmtTime(f.createdAt)}</span> },
    {
      header: 'node',
      cell: (f) => (
        <span title={f.wallet} className="muted">
          {shortAddr(f.wallet)}
        </span>
      ),
    },
    { header: 'kind', cell: (f) => <Badge kind="flag">{f.kind}</Badge> },
    { header: 'detail', cell: (f) => f.detail },
    {
      header: 'evidence',
      cell: (f) =>
        f.relatedVerdicts.length === 0 ? (
          <span className="muted">–</span>
        ) : (
          <span title={f.relatedVerdicts.map((v) => v.jobId).join('\n')}>
            {f.relatedVerdicts
              .map((v) => `${(v.similarityBps / 10000).toFixed(2)} ${v.verdict}`)
              .join(', ')}
          </span>
        ),
    },
    {
      header: 'action',
      cell: (f) =>
        f.reviewedAt ? (
          <span className="muted">reviewed{f.reviewedBy ? ` · ${f.reviewedBy}` : ''}</span>
        ) : (
          <button className="ghost" onClick={() => void review(f.id)}>
            mark reviewed
          </button>
        ),
    },
  ];

  return (
    <main>
      <Card title={`Review queue · ${openCount} open`} full>
        <div className="row" style={{ marginBottom: 8 }}>
          <select
            value={status}
            onChange={(e) => {
              const s = e.target.value as 'open' | 'all';
              setStatus(s);
              void load(token, s);
            }}
          >
            <option value="open">open</option>
            <option value="all">all</option>
          </select>
          <input
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            placeholder="reviewer"
            style={{ width: 120 }}
          />
          <button className="ghost" onClick={() => void load()}>
            refresh
          </button>
          <button
            className="ghost"
            onClick={() => {
              sessionStorage.removeItem(TOKEN_KEY);
              setFlags(null);
              setToken('');
            }}
          >
            forget token
          </button>
        </div>
        {error ? (
          <div className="error" style={{ marginBottom: 8 }}>
            {error}
          </div>
        ) : null}
        <Table columns={columns} rows={flags} empty="no flags in this view" />
      </Card>
    </main>
  );
}
