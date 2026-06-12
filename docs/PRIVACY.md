# QueraIS — Privacy Notice

_Last updated: 2026-06-12. Canonical home: this repository (`docs/PRIVACY.md`);
a hosted copy will replace this URL when the docs site ships._

**The three things you should know before sending a single prompt:**

1. **~5% of prompts are re-run on verification infrastructure.** To catch
   dishonest nodes, the gateway randomly samples completed jobs and re-executes
   the same prompt on oracle infrastructure operated by the protocol, then
   compares the outputs semantically. Your sampled prompt is therefore
   processed twice: once by the serving node, once by the oracle.
2. **Prompts and outputs are processed in memory; only hashes are persisted.**
   The gateway does not write prompt or completion text to disk or database —
   settlement records, reputation data, and verification checks store
   **SHA-256 hashes** and numeric scores, not content. (In-memory processing
   still means the serving node and, when sampled, the oracle see the
   plaintext while the job runs.)
3. **Anomalies can trigger on-chain disputes.** If verification flags a node's
   output, the protocol can open a public, on-chain dispute against that
   provider. Disputes reference job IDs and hashes — **not** prompt text — but
   the existence and outcome of the dispute is permanently public.

## What we process, and where it lives

| Data | Who sees it | Persisted? |
| --- | --- | --- |
| Prompt + completion text | The serving node; the oracle when sampled (~5%) | No — memory only, on both |
| Prompt/result SHA-256 hashes, token counts, timing | Gateway | Yes — settlement + reputation records (SQLite + on-chain batch records) |
| Your wallet address + API key + quota tier | Gateway | Yes — key store |
| Node operator wallet, stake, reputation, flags | Everyone (public API + chain) | Yes — on-chain + gateway DB |
| Verification scores + flags (no text) | Gateway admin review queue | Yes |
| IP addresses / transport metadata | Gateway host (Fly.io) standard request logs | Per host's log retention |

## What we do NOT do

- We do not store prompt or completion text server-side.
- We do not sell or share request data with anyone — there is no analytics
  pipeline; the only "third parties" are the node that serves your job and,
  when sampled, the protocol's own oracle.
- We do not associate prompts with identity beyond the API key → wallet
  binding you provided.

## What we cannot promise

**Independent node operators run their own machines.** The daemon we ship does
not log prompt text, but we cannot technically prevent a modified node from
recording what it serves. Treat any prompt sent through the network as visible
to the operator who serves it. Do not send secrets or personal data — this is
also a term of service.

## On-chain data is forever

Wallet addresses, stakes, settlements, disputes, and reputation snapshots live
on a public blockchain and cannot be deleted. Choose wallets accordingly.

## Contact

Privacy questions: **shavitrwork@gmail.com**. Security reports:
[SECURITY.md](../SECURITY.md).
