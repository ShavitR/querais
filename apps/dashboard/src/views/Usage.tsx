/**
 * Usage — the signed-in requester's settled totals (jobs / tokens / QAIS spent) and tier.
 * Quotas are per-tier daily budgets enforced server-side (Slice 3); the exact remaining
 * budget rides on `x-querais-quota-*` response headers, surfaced live in the Playground.
 */
import { getUsage } from '../api/client';
import { usePoll } from '../hooks/usePoll';
import { useSession } from '../auth/session';
import { Card, StatRow } from '../components/kit';
import { fmtQais, shortAddr } from '../lib/format';

export function Usage() {
  const { me } = useSession();
  const usage = usePoll(getUsage, 5000, [me?.wallet ?? null]);

  if (!me) {
    return (
      <main>
        <Card title="Usage" full>
          <span className="muted">Sign in to see your usage.</span>
        </Card>
      </main>
    );
  }

  return (
    <main>
      <Card title="Usage">
        <StatRow label="Wallet" value={shortAddr(me.wallet)} />
        <StatRow label="Tier" value={me.tier} />
        <StatRow label="Jobs served" value={usage.data?.jobsServed ?? '…'} />
        <StatRow label="Tokens served" value={usage.data?.tokensServed ?? '…'} />
        <StatRow label="QAIS spent" value={usage.data ? fmtQais(usage.data.qaisSpentWei) : '…'} />
      </Card>
      <Card title="About quotas">
        <span className="muted">
          Daily job + token budgets are enforced per tier and derived from your settled jobs over a
          rolling 24h window. When you hit a limit, requests return 429 with
          <code> x-querais-quota-*</code> headers showing what's left.
        </span>
      </Card>
    </main>
  );
}
