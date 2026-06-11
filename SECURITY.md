# Security Policy

QueraIS moves real value on-chain (testnet today, mainnet eventually). We take
every report seriously and would much rather hear about a problem privately
than read about it in a block explorer.

## Reporting a vulnerability

**Email: shavitrwork@gmail.com** — include "SECURITY" in the subject line.

Please report privately. Do **not** open a public GitHub issue for anything
that could be exploited: key handling, settlement math, signature
verification, access control on the contracts, gateway authentication, or
anything that lets a node get paid for work it didn't do.

What helps us act fast:

- A description of the issue and the component (contract / gateway / daemon / SDK).
- Steps or a proof-of-concept to reproduce (testnet reproductions are perfect —
  never demonstrate against other people's funds or nodes).
- Your assessment of impact, if you have one.

You can expect an acknowledgement within 72 hours and a status update as we
triage. We will credit reporters in the fix's release notes unless you ask us
not to.

## Scope

| Component | In scope |
| --- | --- |
| Smart contracts (`packages/contracts`) | Yes — staking, escrow, settlement, disputes, treasury, access control |
| Gateway (`packages/gateway`) | Yes — auth, sessions, settlement batching, faucet, admin surface |
| Node daemon (`packages/node-daemon`) | Yes — key handling, handshake, job signing |
| SDKs (`packages/sdk`, `sdk-python`) | Yes — key handling, request signing |
| The hosted gateway (`querais-gateway.fly.dev`) | Testnet only — please keep testing non-destructive (no DoS, no faucet draining for its own sake) |
| Third-party dependencies | Report upstream first; tell us if we're exposed |

## Bug bounty

There is **no paid bounty program yet** — the protocol is pre-token-value, on
testnet. When mainnet launches a funded program is planned; reports made before
then will be remembered when it exists.

## Known / accepted findings

Static-analysis findings that have been triaged and accepted (with rationale)
are recorded in [`docs/SLITHER_TRIAGE.md`](docs/SLITHER_TRIAGE.md). Please read
it before reporting a Slither/static-analyzer hit — if it's listed there with
a rationale you disagree with, that disagreement itself is a welcome report.

## Keys & secrets

If you find a **committed secret or private key** anywhere in this repository
or its history, treat it as critical and email immediately. (Note: the
well-known Hardhat development keys — `0xac0974be…`, `0x59c6995e…`, etc. —
appear intentionally in test code; they are public constants shipped with
Hardhat itself and hold nothing.)
