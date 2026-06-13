/**
 * The 10A landing view: a read-only network overview at parity with the retired inline
 * dashboard (network stats + node leaderboard), plus a per-account usage card when signed
 * in. The real consoles — playground, keys, jobs, sessions (10B); operator/admin (10C);
 * the full live explorer (10D) — build on this shell.
 */
import { getNodes, getStats, getUsage } from '../api/client';
import type { NodeInfo } from '../api/types';
import { usePoll } from '../hooks/usePoll';
import { useSession } from '../auth/session';
import { Bars, Badge, Card, StatRow, Table } from '../components/kit';
import type { Column } from '../components/kit';

const fmtQais = (wei: string): string => (Number(wei) / 1e18).toFixed(4);

export function Overview() {
  const stats = usePoll(getStats, 2000);
  const nodes = usePoll(getNodes, 2000);

  const nodeRows = [...(nodes.data?.data ?? [])].sort(
    (a, b) => b.jobsServed - a.jobsServed || b.reputation - a.reputation,
  );

  const columns: Column<NodeInfo>[] = [
    { header: '#', cell: (_n, i) => i + 1 },
    {
      header: 'wallet',
      cell: (n) => (
        <span title={n.wallet}>
          {n.wallet.slice(0, 8)}…{n.wallet.slice(-4)}
        </span>
      ),
    },
    { header: 'rep', cell: (n) => n.reputation.toFixed(2) },
    {
      header: 'dimensions',
      cell: (n) => (
        <Bars
          values={[
            n.dimensions.accuracy,
            n.dimensions.uptime,
            n.dimensions.latency,
            n.dimensions.longevity,
            n.dimensions.stake,
          ]}
        />
      ),
    },
    { header: 'jobs', cell: (n) => n.jobsServed },
    {
      header: 'flags',
      cell: (n) =>
        n.flags > 0 ? <Badge kind="flag">{n.flags}</Badge> : <span className="muted">0</span>,
    },
    { header: 'models', cell: (n) => n.models.map((m) => m.model).join(', ') || '–' },
  ];

  return (
    <main>
      <Card title="Network">
        {stats.error && !stats.data ? (
          <span className="muted">gateway warming up…</span>
        ) : (
          <>
            <StatRow label="Active nodes" value={stats.data?.nodes ?? '–'} />
            <StatRow label="Models" value={stats.data?.models.join(', ') || '–'} />
            <StatRow label="Jobs settled" value={stats.data?.jobs.settled ?? '–'} />
            <StatRow label="Tokens served" value={stats.data?.jobs.tokensServed ?? '–'} />
            <StatRow label="Jobs failed" value={stats.data?.jobs.failed ?? '–'} />
            <StatRow
              label="Treasury (QAIS)"
              value={stats.data ? Number(stats.data.treasury.balanceQais).toFixed(4) : '–'}
            />
          </>
        )}
      </Card>

      <AccountCard />

      <Card title="Node leaderboard" full>
        <Table columns={columns} rows={nodeRows} empty="no nodes connected" />
      </Card>
    </main>
  );
}

/** Per-account usage — only meaningful (and only fetched) when signed in. */
function AccountCard() {
  const { me } = useSession();
  const usage = usePoll(getUsage, 5000, [me?.wallet ?? null]);

  if (!me) {
    return (
      <Card title="Your account">
        <span className="muted">
          Sign in with an API key to see your usage. Browsing read-only.
        </span>
      </Card>
    );
  }

  return (
    <Card title="Your account">
      <StatRow label="Wallet" value={`${me.wallet.slice(0, 8)}…${me.wallet.slice(-4)}`} />
      <StatRow label="Tier" value={me.tier} />
      <StatRow label="Jobs served" value={usage.data?.jobsServed ?? '…'} />
      <StatRow label="Tokens served" value={usage.data?.tokensServed ?? '…'} />
      <StatRow label="QAIS spent" value={usage.data ? fmtQais(usage.data.qaisSpentWei) : '…'} />
    </Card>
  );
}
