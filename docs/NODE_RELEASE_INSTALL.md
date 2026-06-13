# Run a QueraIS Node from a Release Archive

Serve AI inference jobs and earn QAIS — no repo clone, no pnpm, no build step.
The release archive contains the entire daemon bundled into one file.

## Easiest: one-line install

One command installs Node.js if you don't have it, downloads + checksum-verifies the
latest node, sets up a working config, and starts serving — nothing to edit:

```powershell
# Windows (PowerShell)
iwr -useb https://querais.xyz/install.ps1 | iex
```

```sh
# macOS / Linux
curl -fsSL https://querais.xyz/install.sh | sh
```

It installs to `~/querais-node`. To restart later, re-run the launcher in that folder
(`.\run-node.ps1` / `./run-node.sh`). The manual archive steps below do the same thing by hand.

## Requirements

- **Node.js ≥ 22.13** — https://nodejs.org (the installer/launcher checks, and the one-liner installs it for you)
- **Ollama** — https://ollama.com (runs the models). The launcher **installs + starts it for you if it's missing** (Windows via winget, Linux/macOS via the official install script).
- A GPU helps but is not required for small models.

## Manual install (≈5 minutes)

1. **Download** the latest `querais-node-vX.Y.Z.tar.gz` and `SHA256SUMS` from the
   GitHub Releases page.

2. **Verify** the archive:

   ```sh
   # Linux/macOS
   sha256sum -c SHA256SUMS
   # Windows (PowerShell)
   (Get-FileHash querais-node-vX.Y.Z.tar.gz -Algorithm SHA256).Hash
   # …must equal the hex in SHA256SUMS
   ```

3. **Extract** (Windows 10+ ships `tar` too):

   ```sh
   tar -xzf querais-node-vX.Y.Z.tar.gz
   cd querais-node-vX.Y.Z
   ```

4. **Run it** — one command, no editing, no second run:

   ```sh
   ./run-node.sh        # Windows: .\run-node.ps1
   ```

   On the first run it writes a `.env` with working testnet defaults (public gateway,
   models `llama3.2` + `gemma3:4b`, stake 2500 QAIS) and a freshly generated wallet
   password, then boots straight into serving. Want to customize models or stake? Edit
   the generated `.env` and re-run.

## What happens on first boot

1. A wallet is generated and saved as an **encrypted keystore** at
   `~/.querais/keystore.json`, encrypted with the `DAEMON_KEYSTORE_PASSWORD` the
   launcher generated into `.env` on first run. Your key never leaves the machine —
   keep `.env` private (or set your own `NODE_PRIVATE_KEY` to use an existing wallet).
2. Missing models in `DAEMON_MODELS` are pulled from Ollama automatically.
3. If the gateway pins model digests (a signed **model manifest**), the daemon
   verifies its local models against it and refuses to advertise ones that would
   be rejected — the log names the expected digest so you can re-pull.
4. On testnet, if the gateway has a **faucet** enabled (`DAEMON_AUTO_FAUCET=true`),
   the daemon claims gas + stake from it, stakes QAIS, and registers on-chain. If the
   gateway has no faucet configured, fund the printed wallet address with testnet ETH
   + QAIS yourself — until it's funded, on-chain registration can't complete.
5. It connects to the gateway over WebSocket and starts serving jobs. Payment
   settles on-chain: **95% to you, 5% protocol fee**.

## Day-2 basics

- **Logs** are JSON on stdout — pipe through `npx pino-pretty` for human format.
- **Stop** with Ctrl-C; restart with the launcher. Registration and stake persist
  on-chain; reconnection is automatic with backoff.
- **Reputation** (and therefore job flow) grows with served jobs and uptime;
  verified-bad results slash stake. See `querais_reputation_system.md` in the repo.
- **Earnings**: watch your wallet on the network explorer, or
  `GET /v1/nodes` on the gateway for your live reputation/price/flags.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Inference backend 'ollama' unavailable` | The launcher auto-installs + starts Ollama; if it persists (e.g. no winget), install it from https://ollama.com and check `OLLAMA_URL`. |
| `QueraIS needs Node >= 22.13` | Upgrade Node (the bundle uses `node:sqlite`-era APIs). |
| `All served models fail the gateway's model manifest` | The gateway pins different model builds — re-pull the tags named in the warnings (`ollama pull <model>`); the expected digest is in the log. |
| `No deployment found at …deployments/addresses.<net>.json` | `NETWORK` in `.env` names a manifest that isn't in the archive's `deployments/` directory. |
| `No models available to serve` | The models in `DAEMON_MODELS` aren't pulled. `ollama pull <model>` (run `ollama list` to see exact names). Bare names like `llama3.2` match Ollama's `llama3.2:latest`. |
| `wrong DAEMON_KEYSTORE_PASSWORD` on boot | Use the password the keystore (`~/.querais/keystore.json`) was created with. The default is a well-known dev password; a custom one must match exactly. |
| Faucet 404 / `faucet did not grant` on boot | The gateway has no faucet configured (or it's throttling/empty). Fund the printed wallet address with testnet ETH + QAIS directly and set `DAEMON_AUTO_FAUCET=false`. |

## Security notes

- The keystore key is a **hot key for node operations only** — don't reuse a
  wallet that holds anything else.
- Never paste your private key anywhere; the daemon never needs you to.
- Verify `SHA256SUMS` before extracting any archive.
