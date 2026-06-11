/**
 * Signed model manifest — the operator's off-chain statement of which model
 * binaries (by Ollama sha256 digest) count as "the real model" on this network.
 *
 * Lives in shared because both sides of the trust relationship consume it:
 * the gateway loads + signs the manifest at boot and enforces it at node
 * handshake; the node daemon fetches it from `GET /v1/models/manifest` and
 * verifies the signature against the gateway's settler address (which it
 * already learns from `/v1/credit/info`) before trusting the digests.
 *
 * Signing is EIP-191 (`personal_sign`) over a canonical JSON form — model keys
 * sorted, entry fields in fixed order — so any holder of the manifest can
 * re-derive the exact signed bytes and verify offline. No contract involved
 * (Slice 9 decision: exclusion, not punishment — a mismatched model is simply
 * not served; slashing stays with the dispute system).
 */
import { recoverMessageAddress, type Address, type Hex } from 'viem';
import { z } from 'zod';

/** Ollama-style digest of the model blob: "sha256:" + 64 lowercase hex chars. */
export const MODEL_DIGEST_REGEX = /^sha256:[0-9a-f]{64}$/;

export const modelManifestEntrySchema = z.object({
  digest: z.string().regex(MODEL_DIGEST_REGEX, 'digest must be "sha256:" + 64 lowercase hex chars'),
  /** Free-form operator note ("gemma3:4b pulled 2026-06-01"); not enforced. */
  note: z.string().max(500).optional(),
});

export type ModelManifestEntry = z.infer<typeof modelManifestEntrySchema>;

/** The unsigned manifest body — what the operator authors as a JSON file. */
export const modelManifestSchema = z
  .object({
    models: z.record(z.string().min(1).max(200), modelManifestEntrySchema),
  })
  .strict();

export type ModelManifest = z.infer<typeof modelManifestSchema>;

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

/** Wire form served by `GET /v1/models/manifest` (and verified by daemons). */
export const signedModelManifestSchema = z.object({
  models: z.record(z.string().min(1).max(200), modelManifestEntrySchema),
  signer: hexAddress,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export interface SignedModelManifest {
  models: Record<string, ModelManifestEntry>;
  /** The gateway wallet that signed — daemons check it equals the settler. */
  signer: Address;
  /** EIP-191 signature over `canonicalModelManifestJson(models)`. */
  signature: Hex;
}

/**
 * The exact byte string that gets signed: `{"models":{...}}` with model keys
 * sorted and entry fields in fixed (digest, note) order. Deterministic across
 * runtimes, so gateway and daemon always derive identical bytes.
 */
export function canonicalModelManifestJson(models: Record<string, ModelManifestEntry>): string {
  const sorted: Record<string, ModelManifestEntry> = {};
  for (const name of Object.keys(models).sort()) {
    const entry = models[name]!;
    sorted[name] =
      entry.note === undefined
        ? { digest: entry.digest }
        : { digest: entry.digest, note: entry.note };
  }
  return JSON.stringify({ models: sorted });
}

/** Minimal signer shape — viem LocalAccount and (account-bound) WalletClient both satisfy it. */
export interface ManifestSigner {
  signMessage(args: { message: string }): Promise<Hex>;
}

/** Sign the manifest with the gateway key (done once at boot). */
export async function signModelManifest(
  signer: ManifestSigner,
  signerAddress: Address,
  models: Record<string, ModelManifestEntry>,
): Promise<SignedModelManifest> {
  const signature = await signer.signMessage({ message: canonicalModelManifestJson(models) });
  return { models, signer: signerAddress, signature };
}

/**
 * Verify a fetched manifest: recover the EIP-191 signer from the canonical
 * JSON and compare to the claimed `signer`. Pure (no RPC); returns false on
 * any malformed input rather than throwing.
 */
export async function verifyModelManifest(manifest: SignedModelManifest): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({
      message: canonicalModelManifestJson(manifest.models),
      signature: manifest.signature,
    });
    return recovered.toLowerCase() === manifest.signer.toLowerCase();
  } catch {
    return false;
  }
}
