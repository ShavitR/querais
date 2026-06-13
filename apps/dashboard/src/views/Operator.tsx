/**
 * Operator console (Slice 10C) — a node operator's view of their OWN node, wallet-gated by
 * the session cookie (the gateway scopes `/v1/operator/overview` strictly to the signed-in
 * wallet). Read-only: earnings, the 5-dimension reputation + its published history, the
 * time-to-first-token trend, and the flags raised against the node (incl. reviewed).
 */
import { getOperatorOverview } from '../api/client';
import type { NodeFlag } from '../api/types';
import { usePoll } from '../hooks/usePoll';
import { useSession } from '../auth/session';
import { Badge, Bars, Card, StatRow, Table } from '../components/kit';
import type { Column } from '../components/kit';
import { fmtQais, fmtTime, shortAddr } from '../lib/format';

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : Math.round(((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2);
}

const flagColumns: Column<NodeFlag>[] = [
  { header: 'when', cell: (f) => <span className="muted">{fmtTime(f.createdAt)}</span> },
  { header: 'kind', cell: (f) => <Badge kind="flag">{f.kind}</Badge> },
  { header: 'detail', cell: (f) => f.detail },
  {
    header: 'status',
    cell: (f) =>
      f.reviewedAt ? (
        <span className="muted">reviewed{f.reviewedBy ? ` · ${f.reviewedBy}` : ''}</span>
      ) : (
        <Badge kind="flag">open</Badge>
      ),
  },
];

export function Operator() {
  const { me } = useSession();
  const ov = usePoll(getOperatorOverview, 5000, [me?.wallet ?? null]);

  if (!me) {
    return (
      <main>
        <Card title="Operator console" full>
          <span className="muted">
            Sign in with your node's wallet (<b>connect wallet</b>, top right) to see your earnings,
            reputation, latency, and any flags against your node.
          </span>
        </Card>
      </main>
    );
  }

  const d = ov.data;
  const rep = d?.reputation;
  // oldest → newest composite (0..1) for the trend sparkline.
  const history = (d?.reputationHistory ?? [])
    .slice()
    .reverse()
    .map((s) => s.compositeBps / 10000);
  const ttft = d?.ttftMs ?? [];
  const ttftMax = ttft.length ? Math.max(...ttft) : 0;

  return (
    <main>
      <Card title="Your node">
        <StatRow label="Wallet" value={shortAddr(me.wallet)} />
        <StatRow
          label="Status"
          value={
            d ? (
              d.connected ? (
                <Badge>connected</Badge>
              ) : (
                <span className="muted">offline</span>
              )
            ) : (
              '…'
            )
          }
        />
        <StatRow label="Jobs served" value={d?.jobsServed ?? '–'} />
        <StatRow label="Models" value={d?.models.map((m) => m.model).join(', ') || '–'} />
        <StatRow
          label="Claimable rewards (QAIS)"
          value={d ? fmtQais(d.claimableRewardsWei) : '…'}
        />
      </Card>

      <Card title="Reputation">
        <StatRow label="Composite" value={rep ? rep.composite.toFixed(2) : '…'} />
        {rep ? (
          <>
            <div style={{ marginTop: 8 }}>
              <Bars values={[rep.accuracy, rep.uptime, rep.latency, rep.longevity, rep.stake]} />
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              accuracy · uptime · latency · longevity · stake
            </div>
          </>
        ) : null}
        {history.length > 1 ? (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 11 }}>
              composite history ({history.length} snapshots)
            </div>
            <Bars values={history.slice(-24)} />
          </div>
        ) : null}
      </Card>

      <Card title="Latency — time to first token">
        {ttft.length > 0 ? (
          <>
            <StatRow label="Samples (30d)" value={ttft.length} />
            <StatRow label="Median" value={`${median(ttft)} ms`} />
            <div style={{ marginTop: 8 }}>
              <Bars values={ttft.slice(-24).map((x) => (ttftMax > 0 ? x / ttftMax : 0))} />
            </div>
          </>
        ) : (
          <span className="muted">no latency samples yet</span>
        )}
      </Card>

      <Card title="Flags against your node" full>
        <Table columns={flagColumns} rows={d?.flags ?? []} empty="no flags — clean record" />
      </Card>
    </main>
  );
}
