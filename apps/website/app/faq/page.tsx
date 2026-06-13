import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'FAQ',
  description:
    'Common questions about QueraIS: is it real money, prompt privacy, models, running a node, anti-cheat, and decentralization.',
};

const FAQS: { q: string; a: string }[] = [
  {
    q: 'Is this real money?',
    a: 'No. QueraIS runs on the Arbitrum Sepolia testnet — $QAIS has no real value. It exists to try the protocol end-to-end.',
  },
  {
    q: 'Are my prompts private?',
    a: 'Prompts and outputs are processed in memory and never persisted — only hashes and scores are stored. About 5% of jobs are re-run on oracle infrastructure for verification, and a verification anomaly can trigger an on-chain dispute against the provider.',
  },
  {
    q: 'What models can I use?',
    a: 'Whatever the connected nodes serve right now (e.g. gemma3:4b, llama3.2, qwen3). GET /v1/models lists what is live.',
  },
  {
    q: 'How do I get an API key?',
    a: 'During the beta the operator issues them — ask in the project channel or open a GitHub issue. Self-serve signup is coming.',
  },
  {
    q: 'What do I need to run a node?',
    a: 'Node 22.13+, Ollama with a model pulled, and a few minutes. A prebuilt release runs without building from source. You stake $QAIS (from the faucet) to participate and earn for every token you serve.',
  },
  {
    q: 'How is cheating prevented?',
    a: 'Layer-B structural checks on every job, Layer-A semantic re-sampling on ~5%, a 5-dimension reputation score, staking with slashing, and FAST-track disputes. Cross-node output hashing is deliberately NOT used — temperature 0 is not deterministic across GPUs.',
  },
  {
    q: 'Is it decentralized?',
    a: 'Partially. Today a single trusted gateway does matching and settlement; its worst case is bounded — it can only settle at signed prices, never steal deposits. The P2P mesh, on-chain auction, and decentralized oracle are the Phase-4 roadmap.',
  },
];

export default function FAQ() {
  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <h1>FAQ</h1>
      <div className="faq" style={{ marginTop: 20, maxWidth: 760 }}>
        {FAQS.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
