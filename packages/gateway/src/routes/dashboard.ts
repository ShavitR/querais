import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';
import { TERMS_URL, PRIVACY_URL } from './keys.js';

/**
 * GET / — a self-contained, read-only dashboard (no build step). Polls /v1/stats and
 * /v1/nodes and offers a streaming prompt box hitting /v1/chat/completions. The first
 * configured API key is injected for local-dev convenience.
 */
export function registerDashboard(app: FastifyInstance, deps: GatewayDeps): void {
  const apiKey = [...deps.config.apiKeys.keys()][0] ?? '';
  app.get('/', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(html(apiKey));
  });
}

function html(apiKey: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QueraIS Dashboard</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; background:#0b0f17; color:#d6e1ef; }
  header { padding:16px 24px; border-bottom:1px solid #1d2738; display:flex; align-items:center; gap:12px; }
  header h1 { font-size:18px; margin:0; letter-spacing:.5px; }
  .dot { width:9px; height:9px; border-radius:50%; background:#2ec26b; box-shadow:0 0 8px #2ec26b; }
  main { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:24px; max-width:1100px; }
  .card { background:#111726; border:1px solid #1d2738; border-radius:10px; padding:16px; }
  .card h2 { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#7d8aa3; margin:0 0 12px; }
  .stat { display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed #1d2738; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:6px 4px; border-bottom:1px solid #1d2738; }
  th { color:#7d8aa3; font-weight:600; }
  .full { grid-column:1 / -1; }
  textarea,select,button { font:inherit; background:#0b0f17; color:#d6e1ef; border:1px solid #1d2738; border-radius:8px; padding:8px; }
  textarea { width:100%; min-height:64px; resize:vertical; }
  button { background:#2563eb; border-color:#2563eb; color:#fff; cursor:pointer; padding:8px 16px; }
  button:disabled { opacity:.5; cursor:default; }
  .row { display:flex; gap:8px; align-items:center; margin-top:8px; }
  #out { white-space:pre-wrap; background:#0b0f17; border:1px solid #1d2738; border-radius:8px; padding:12px; min-height:60px; margin-top:12px; }
  .muted { color:#7d8aa3; }
  footer { padding:12px 24px; border-top:1px solid #1d2738; font-size:12px; }
  footer a { color:#7d8aa3; }
</style>
</head>
<body>
<header><span class="dot"></span><h1>QueraIS</h1><span class="muted">decentralized AI compute marketplace — local dev</span></header>
<main>
  <section class="card">
    <h2>Network</h2>
    <div class="stat"><span>Active nodes</span><b id="s-nodes">–</b></div>
    <div class="stat"><span>Models</span><b id="s-models">–</b></div>
    <div class="stat"><span>Jobs settled</span><b id="s-settled">–</b></div>
    <div class="stat"><span>Tokens served</span><b id="s-tokens">–</b></div>
    <div class="stat"><span>Jobs failed</span><b id="s-failed">–</b></div>
    <div class="stat"><span>Treasury fees (QAIS)</span><b id="s-treasury">–</b></div>
  </section>
  <section class="card">
    <h2>Node Leaderboard</h2>
    <table><thead><tr><th>#</th><th>wallet</th><th>rep</th><th>jobs</th><th>models</th></tr></thead><tbody id="nodes"></tbody></table>
  </section>
  <section class="card full">
    <h2>Try it</h2>
    <textarea id="prompt">Say hello in one short sentence.</textarea>
    <div class="row">
      <select id="model"></select>
      <button id="send">Send</button>
      <span class="muted" id="usage"></span>
    </div>
    <div id="out"></div>
  </section>
</main>
<footer class="muted">testnet — tokens have no value · <a href="${TERMS_URL}">terms</a> · <a href="${PRIVACY_URL}">privacy</a></footer>
<script>
const API_KEY = ${JSON.stringify(apiKey)};
async function refresh() {
  try {
    const stats = await (await fetch('/v1/stats')).json();
    document.getElementById('s-nodes').textContent = stats.nodes;
    document.getElementById('s-models').textContent = stats.models.join(', ') || '–';
    document.getElementById('s-settled').textContent = stats.jobs.settled;
    document.getElementById('s-tokens').textContent = stats.jobs.tokensServed;
    document.getElementById('s-failed').textContent = stats.jobs.failed;
    document.getElementById('s-treasury').textContent = Number(stats.treasury.balanceQais).toFixed(6);
    const sel = document.getElementById('model');
    const cur = sel.value;
    sel.innerHTML = stats.models.map(m => '<option>'+m+'</option>').join('');
    if (cur) sel.value = cur;
    const nodes = (await (await fetch('/v1/nodes')).json()).data;
    nodes.sort((a, b) => (b.jobsServed - a.jobsServed) || (b.reputation - a.reputation));
    document.getElementById('nodes').innerHTML = nodes.map((n, i) =>
      '<tr><td>'+(i+1)+'</td><td>'+n.wallet.slice(0,10)+'…</td><td>'+n.reputation.toFixed(2)+'</td><td>'+n.jobsServed+'</td><td>'+n.models.map(x=>x.model).join(', ')+'</td></tr>'
    ).join('') || '<tr><td colspan=5 class=muted>no nodes connected</td></tr>';
  } catch (e) { /* gateway warming up */ }
}
setInterval(refresh, 2000); refresh();

document.getElementById('send').onclick = async () => {
  const btn = document.getElementById('send'); btn.disabled = true;
  const out = document.getElementById('out'); out.textContent = '';
  document.getElementById('usage').textContent = '';
  try {
    const res = await fetch('/v1/chat/completions', {
      method:'POST',
      headers:{'content-type':'application/json','authorization':'Bearer '+API_KEY},
      body: JSON.stringify({ model: document.getElementById('model').value,
        messages:[{role:'user',content:document.getElementById('prompt').value}], stream:true, max_tokens:256 })
    });
    if (!res.ok || !res.body) { out.textContent = 'Error: HTTP '+res.status+' '+await res.text(); btn.disabled=false; return; }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf='';
    for(;;){ const {value,done}=await reader.read(); if(done)break; buf+=dec.decode(value,{stream:true});
      let i; while((i=buf.indexOf('\\n\\n'))!==-1){ const line=buf.slice(0,i); buf=buf.slice(i+2);
        const m=line.replace(/^data: /,'').trim(); if(!m||m==='[DONE]')continue;
        try { const j=JSON.parse(m); const d=j.choices?.[0]?.delta?.content; if(d) out.textContent+=d; } catch(_){}
      }
    }
  } catch(e){ out.textContent='Error: '+e.message; }
  btn.disabled = false;
};
</script>
</body>
</html>`;
}
