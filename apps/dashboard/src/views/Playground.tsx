/**
 * Playground — the "try it" box, grown up: a model picker, a prompt, streamed output, and a
 * best-effort per-request cost readout (the usage delta across the call). Authenticated by
 * the session cookie (sign in first). The flagship deposit/session/EIP-712 flow is 10B-2.
 */
import { useEffect, useState } from 'react';
import { getModels, getUsage, streamChat } from '../api/client';
import { useSession } from '../auth/session';
import { Card } from '../components/kit';

export function Playground() {
  const { me } = useSession();
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('Say hello in one short sentence.');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ tokens: number; qais: number } | null>(null);

  useEffect(() => {
    getModels()
      .then((r) => {
        const ids = r.data.map((m) => m.id);
        setModels(ids);
        setModel((prev) => prev || ids[0] || '');
      })
      .catch(() => {
        /* no models advertised yet */
      });
  }, []);

  if (!me) {
    return (
      <main>
        <Card title="Playground" full>
          <span className="muted">Sign in with an API key (top right) to run a completion.</span>
        </Card>
      </main>
    );
  }

  const send = async () => {
    if (!model || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    setOutput('');
    setLast(null);
    const before = await getUsage().catch(() => null);
    try {
      await streamChat(
        { model, messages: [{ role: 'user', content: prompt }], max_tokens: 256 },
        (d) => setOutput((o) => o + d),
      );
      // Best-effort per-request cost from the usage delta (the batched venue may lag a beat).
      const after = await getUsage().catch(() => null);
      if (before && after) {
        setLast({
          tokens: Math.max(0, after.tokensServed - before.tokensServed),
          qais: Math.max(0, (Number(after.qaisSpentWei) - Number(before.qaisSpentWei)) / 1e18),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <Card title="Playground" full>
        <div className="row" style={{ marginBottom: 8 }}>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.length === 0 ? (
              <option value="">no models available</option>
            ) : (
              models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))
            )}
          </select>
          <button disabled={busy || !model} onClick={() => void send()}>
            {busy ? 'streaming…' : 'Send'}
          </button>
          {last ? (
            <span className="muted">
              last request: {last.tokens} tok · {last.qais.toFixed(4)} QAIS
            </span>
          ) : null}
        </div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        {error ? <div className="error">{error}</div> : null}
        <div className="output">{output || <span className="muted">output appears here</span>}</div>
      </Card>
    </main>
  );
}
