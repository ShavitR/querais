# QueraIS — Terms of Service

_Last updated: 2026-06-12. Canonical home: this repository (`docs/TERMS.md`);
a hosted copy will replace this URL when the docs site ships._

## 1. What this is

QueraIS is an **experimental, testnet-only** decentralized AI inference
marketplace. Requests you send through the gateway are served by independent
GPU node operators, matched by price, reputation, and speed, and settled in
$QAIS tokens on the Arbitrum Sepolia **test network**.

By requesting an API key or running a node you agree to these terms.

## 2. Testnet — nothing here has value

- $QAIS on testnet is a **valueless test token**. It is not money, not an
  investment, and not redeemable for anything. Faucet balances, staking
  positions, fees, and rewards can be **wiped at any time** by a redeploy.
- The service is provided **as is, with no warranty and no SLA**. It may be
  paused, rate-limited, redeployed, or shut down without notice.
- Nothing in this repository or service is financial, legal, or investment
  advice. No token sale is offered or implied.

## 3. Your content goes to third parties

This is a marketplace, not a single provider: **your prompts are executed on
machines owned by independent node operators we do not control.** Do not send
secrets, personal data, regulated data, or anything you would not hand to an
unknown third party. See the [Privacy Notice](PRIVACY.md) for exactly what is
processed, sampled, and stored.

## 4. Acceptable use

You agree not to:

- attempt to extract other users' data or other operators' keys;
- attack the service (DoS, faucet draining, settlement griefing, deliberately
  serving wrong inference results to farm payments);
- use the network for content that is illegal where you or the serving node
  operate;
- resell access in a way that hides these terms from the end user.

Verification (Layer A/B) and the dispute system exist to catch dishonest
serving; triggering them dishonestly is itself a violation.

## 5. Node operators

Running a node means you execute other people's prompts on your hardware and
are paid in test tokens for doing so. You are responsible for your machine,
your electricity, your keys, and your local law. Staked test tokens can be
slashed by the dispute process described in the protocol docs.

## 6. Fees

The protocol charges a 5% fee on settled jobs, routed on-chain to the protocol
treasury (60% operations / 20% burned / 20% to stakers). On testnet these
flows are real mechanics with valueless tokens.

## 7. Changes

These terms will change as the protocol moves toward mainnet. Material changes
land in this file's git history — the diff is the changelog. Continued use
after a change is acceptance.

## 8. Contact

Questions and reports: **shavitrwork@gmail.com** (security issues: see
[SECURITY.md](../SECURITY.md)).
