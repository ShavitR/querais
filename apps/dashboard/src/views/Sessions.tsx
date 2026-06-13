/**
 * Credit & sessions — the flagship that makes Slice 2 (batched session-deposit settlement)
 * demoable to a human: deposit QAIS into the CreditAccount, sign ONE EIP-712 spending cap in
 * the browser wallet, then fire completions that batch-settle with zero per-call wallet txs,
 * watching cap-spend / headroom / pending debits live; withdraw-after-notice when done.
 */
import { useState } from 'react';
import { parseEther, type Address } from 'viem';
import { getCreditInfo, getSession, postSession } from '../api/client';
import type { CreditInfo } from '../api/types';
import { usePoll } from '../hooks/usePoll';
import { useSession } from '../auth/session';
import { Card, StatRow } from '../components/kit';
import { fmtQais } from '../lib/format';
import { spendingCapDomain } from '../lib/contracts';
import {
  allowance,
  approve,
  completeWithdrawal,
  connect,
  deposit,
  ensureChain,
  hasWallet,
  initiateWithdrawal,
  signCap,
  withdrawableAt,
} from '../lib/wallet';

const qais = (wei: string | bigint): string => fmtQais(wei.toString());

export function Sessions() {
  const { me } = useSession();
  const [bump, setBump] = useState(0);
  const refresh = () => setBump((n) => n + 1);

  const info = usePoll(getCreditInfo, 60000);
  const status = usePoll(getSession, 4000, [me?.wallet ?? null, bump]);

  if (!me) {
    return (
      <main>
        <Card title="Credit & sessions" full>
          <span className="muted">Sign in (wallet recommended) to deposit and open a session.</span>
        </Card>
      </main>
    );
  }
  if (status.error && /not enabled/i.test(status.error)) {
    return (
      <main>
        <Card title="Credit & sessions" full>
          <span className="muted">Credit sessions aren't enabled on this gateway.</span>
        </Card>
      </main>
    );
  }

  const s = status.data;
  return (
    <main>
      <Card title="Credit account">
        <StatRow label="Balance (QAIS)" value={s ? qais(s.credit.balanceWei) : '…'} />
        <StatRow
          label="Pending debits"
          value={s ? `${s.pendingDebits.count} · ${qais(s.pendingDebits.totalWei)} QAIS` : '…'}
        />
        <StatRow label="Headroom (QAIS)" value={s?.headroomWei ? qais(s.headroomWei) : '–'} />
      </Card>

      <Card title="Active session">
        {s?.session ? (
          <>
            <StatRow label="Cap (QAIS)" value={qais(s.session.maxSpendWei)} />
            <StatRow label="Spent (QAIS)" value={qais(s.session.spentAgainstWei)} />
            <StatRow label="Remaining (QAIS)" value={qais(s.session.capRemainingWei)} />
            <StatRow
              label="Deadline"
              value={new Date(Number(s.session.deadline) * 1000).toLocaleString()}
            />
          </>
        ) : (
          <span className="muted">No active session — deposit, then open one below.</span>
        )}
      </Card>

      {info.data ? (
        <CreditActions me={me.wallet as Address} info={info.data} onChange={refresh} />
      ) : null}
    </main>
  );
}

function CreditActions({
  me,
  info,
  onChange,
}: {
  me: Address;
  info: CreditInfo;
  onChange: () => void;
}) {
  const [account, setAccount] = useState<Address | null>(null);
  const [depositAmt, setDepositAmt] = useState('1000');
  const [capAmt, setCapAmt] = useState('500');
  const [hours, setHours] = useState('1');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (!hasWallet()) {
    return (
      <Card title="Actions" full>
        <span className="muted">
          A browser wallet (e.g. MetaMask) is needed to deposit and sign.
        </span>
      </Card>
    );
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await ensureChain(info.chainId);
      await fn();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'transaction failed');
    } finally {
      setBusy(null);
    }
  };

  const doConnect = () =>
    run('connect', async () => {
      const { address } = await connect();
      setAccount(address);
      if (address.toLowerCase() !== me.toLowerCase()) {
        setError(
          `Connected ${address.slice(0, 6)}… but signed in as ${me.slice(0, 6)}… — switch the wallet account.`,
        );
      }
    });

  const acct = account;
  const mismatch = acct != null && acct.toLowerCase() !== me.toLowerCase();
  const ready = acct != null && !mismatch;

  const doDeposit = () =>
    run('deposit', async () => {
      if (!acct) throw new Error('Connect a wallet first.');
      const amount = parseEther(depositAmt);
      const have = await allowance(info.token as Address, acct, info.creditAccount as Address);
      if (have < amount)
        await approve(acct, info.token as Address, info.creditAccount as Address, amount);
      await deposit(acct, info.creditAccount as Address, amount);
      setNote(`Deposited ${depositAmt} QAIS.`);
    });

  const doOpenSession = () =>
    run('session', async () => {
      if (!acct) throw new Error('Connect a wallet first.');
      const nowSec = Math.floor(Date.now() / 1000);
      const cap = {
        requester: acct,
        settler: info.settler as Address,
        maxSpendWei: parseEther(capAmt),
        nonce: BigInt(Date.now()),
        deadline: BigInt(nowSec + Math.max(1, Number(hours)) * 3600),
      };
      const domain = spendingCapDomain(info.chainId, info.creditAccount as Address);
      const signature = await signCap(acct, domain, cap);
      await postSession({
        requester: cap.requester,
        settler: cap.settler,
        maxSpendWei: cap.maxSpendWei.toString(),
        nonce: cap.nonce.toString(),
        deadline: cap.deadline.toString(),
        signature,
      });
      setNote(`Session open — cap ${capAmt} QAIS, ${hours}h. No gas per call now.`);
    });

  const doInitiateWithdraw = () =>
    run('withdraw-init', async () => {
      if (!acct) throw new Error('Connect a wallet first.');
      await initiateWithdrawal(acct, info.creditAccount as Address);
      const at = await withdrawableAt(info.creditAccount as Address, acct);
      setNote(`Withdrawal notice started — available at ${new Date(at * 1000).toLocaleString()}.`);
    });

  const doCompleteWithdraw = () =>
    run('withdraw-done', async () => {
      if (!acct) throw new Error('Connect a wallet first.');
      await completeWithdrawal(acct, info.creditAccount as Address);
      setNote('Withdrawal complete.');
    });

  return (
    <Card title="Actions" full>
      {!acct ? (
        <button disabled={busy != null} onClick={() => void doConnect()}>
          {busy === 'connect' ? 'check wallet…' : 'connect wallet'}
        </button>
      ) : (
        <div className="muted" style={{ marginBottom: 8 }}>
          wallet {acct.slice(0, 6)}…{acct.slice(-4)}
          {mismatch ? ' — does not match your signed-in account' : ''}
        </div>
      )}

      {ready ? (
        <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          <div className="row">
            <input
              value={depositAmt}
              onChange={(e) => setDepositAmt(e.target.value)}
              style={{ width: 120 }}
            />
            <button disabled={busy != null} onClick={() => void doDeposit()}>
              {busy === 'deposit' ? 'depositing…' : 'deposit QAIS'}
            </button>
            <span className="muted">approves if needed, then deposits</span>
          </div>
          <div className="row">
            <input
              value={capAmt}
              onChange={(e) => setCapAmt(e.target.value)}
              style={{ width: 120 }}
            />
            <input value={hours} onChange={(e) => setHours(e.target.value)} style={{ width: 60 }} />
            <button disabled={busy != null} onClick={() => void doOpenSession()}>
              {busy === 'session' ? 'check wallet…' : 'sign cap + open session'}
            </button>
            <span className="muted">cap QAIS · hours — one signature, no gas</span>
          </div>
          <div className="row">
            <button
              className="ghost"
              disabled={busy != null}
              onClick={() => void doInitiateWithdraw()}
            >
              {busy === 'withdraw-init' ? '…' : 'start withdrawal'}
            </button>
            <button
              className="ghost"
              disabled={busy != null}
              onClick={() => void doCompleteWithdraw()}
            >
              {busy === 'withdraw-done' ? '…' : 'complete withdrawal'}
            </button>
            <span className="muted">withdraw-after-notice</span>
          </div>
        </div>
      ) : null}

      {note ? (
        <div className="muted" style={{ marginTop: 10 }}>
          {note}
        </div>
      ) : null}
      {error ? (
        <div className="error" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}
    </Card>
  );
}
