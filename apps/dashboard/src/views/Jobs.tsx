/**
 * Jobs explorer — the signed-in requester's recent jobs from GET /v1/jobs (the DB mirror of
 * the on-chain escrow). Status, model, tokens, the 95/5 split, and an Arbiscan link for the
 * provider on known chains. (Per-job venue + settlement-tx links want extra persistence —
 * tracked as a follow-up; the on-chain detail is one click away via GET /v1/jobs/:id.)
 */
import { getCreditInfo, getJobs } from '../api/client';
import type { JobListItem } from '../api/types';
import { usePoll } from '../hooks/usePoll';
import { useSession } from '../auth/session';
import { Badge, Card, Table } from '../components/kit';
import type { Column } from '../components/kit';
import { explorerAddr, fmtQais, fmtTime, shortAddr } from '../lib/format';

function statusBadge(s: JobListItem['status']) {
  if (s === 'failed') return <Badge kind="flag">failed</Badge>;
  return <Badge>{s}</Badge>;
}

export function Jobs() {
  const { me } = useSession();
  const jobs = usePoll(getJobs, 4000, [me?.wallet ?? null]);
  const info = usePoll(getCreditInfo, 60000);
  const chainId = info.data?.chainId;

  if (!me) {
    return (
      <main>
        <Card title="Jobs" full>
          <span className="muted">Sign in to see the jobs you've submitted.</span>
        </Card>
      </main>
    );
  }

  const columns: Column<JobListItem>[] = [
    { header: 'when', cell: (j) => <span className="muted">{fmtTime(j.createdAt)}</span> },
    { header: 'status', cell: (j) => statusBadge(j.status) },
    { header: 'model', cell: (j) => j.model },
    { header: 'tokens', cell: (j) => `${j.actualTokens ?? '–'} / ${j.maxTokens}` },
    { header: 'paid (QAIS)', cell: (j) => fmtQais(j.providerPay) },
    { header: 'fee (QAIS)', cell: (j) => fmtQais(j.protocolFee) },
    {
      header: 'provider',
      cell: (j) => {
        const url = explorerAddr(chainId, j.provider);
        return url ? (
          <a href={url} target="_blank" rel="noreferrer">
            {shortAddr(j.provider)}
          </a>
        ) : (
          <span title={j.provider}>{shortAddr(j.provider)}</span>
        );
      },
    },
  ];

  return (
    <main>
      <Card title="Jobs" full>
        <Table columns={columns} rows={jobs.data?.data ?? []} empty="no jobs yet" />
      </Card>
    </main>
  );
}
