/**
 * Slice 9 daemon self-verify: before connecting, fetch the gateway's signed model
 * manifest (best-effort), verify the signature against the settler address from
 * /v1/credit/info, and report which served models a manifest-enforcing gateway
 * would drop — so the operator learns at boot, not by watching jobs never arrive.
 *
 * Never throws: a gateway without a manifest (404), an unreachable gateway, or a
 * manifest whose signature doesn't check out all degrade to "no skips" (the
 * gateway-side enforcement is the actual security boundary; this is operator UX).
 */
import type { Logger } from 'pino';
import {
  signedModelManifestSchema,
  verifyModelManifest,
  type SignedModelManifest,
} from '@querais/shared';

/** Derive the gateway's HTTP base from its WS URL (ws://h:p/node → http://h:p). */
export function httpBaseFromGatewayWs(wsUrl: string): string {
  return wsUrl.replace(/^ws/, 'http').replace(/\/node$/, '');
}

export interface ManifestSelfCheck {
  /** Served models a manifest-enforcing gateway would drop (mismatch or no digest). */
  skipped: string[];
  /** The verified manifest, when one was fetched and its signature checked out. */
  manifest?: SignedModelManifest;
}

export async function manifestSelfCheck(opts: {
  gatewayHttpBase: string;
  served: string[];
  modelDigests?: Record<string, string>;
  logger: Logger;
  fetchImpl?: typeof fetch;
}): Promise<ManifestSelfCheck> {
  const { gatewayHttpBase, served, modelDigests, logger } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const none: ManifestSelfCheck = { skipped: [] };

  let manifest: SignedModelManifest;
  try {
    const res = await doFetch(`${gatewayHttpBase}/v1/models/manifest`);
    if (res.status === 404) return none; // gateway runs without enforcement
    if (!res.ok) {
      logger.warn({ status: res.status }, 'model manifest fetch failed — skipping self-check');
      return none;
    }
    manifest = signedModelManifestSchema.parse(await res.json()) as SignedModelManifest;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'model manifest unavailable — skipping self-check',
    );
    return none;
  }

  // The manifest must be signed by the gateway's settler wallet — the same address
  // requesters trust with spending caps. Anything else is ignored, loudly.
  try {
    const infoRes = await doFetch(`${gatewayHttpBase}/v1/credit/info`);
    if (!infoRes.ok) throw new Error(`/v1/credit/info ${infoRes.status}`);
    const info = (await infoRes.json()) as { settler?: string };
    const settlerOk =
      typeof info.settler === 'string' &&
      info.settler.toLowerCase() === manifest.signer.toLowerCase();
    if (!settlerOk || !(await verifyModelManifest(manifest))) {
      logger.warn(
        { signer: manifest.signer, settler: info.settler },
        'model manifest signature does NOT verify against the gateway settler — ignoring it',
      );
      return none;
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'could not verify model manifest signature — skipping self-check',
    );
    return none;
  }

  const skipped: string[] = [];
  for (const model of served) {
    const entry = manifest.models[model];
    if (!entry) continue; // unpinned — the gateway lets it through
    const digest = modelDigests?.[model];
    if (digest === entry.digest) continue;
    skipped.push(model);
    logger.warn(
      { model, expected: entry.digest, actual: digest ?? '(no digest reported)' },
      'model will NOT pass the gateway manifest — skipping it (re-pull the pinned version to serve it)',
    );
  }
  return { skipped, manifest };
}
