/**
 * Gateway-side model-manifest loading. The operator points GATEWAY_MODEL_MANIFEST
 * at a JSON file ({"models": {"name": {"digest": "sha256:…", "note": "…"}}});
 * we load and validate it at boot and FAIL FAST on any problem — a gateway
 * silently running with a typo'd manifest would enforce nothing (or worse,
 * drop every honest node). No manifest configured = no enforcement, exactly
 * the Slice 8 behavior.
 *
 * Canonicalization/signing/verification live in @querais/shared (the daemon
 * verifies the same bytes); this module is only the file → ModelManifest edge.
 */
import { readFileSync } from 'node:fs';
import { modelManifestSchema, type ModelManifest } from '@querais/shared';

/** Read + validate the operator's manifest file. Throws a descriptive error on any problem. */
export function loadModelManifest(path: string): ModelManifest {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `model manifest: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `model manifest: ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsed = modelManifestSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`model manifest: ${path} failed validation: ${issues}`);
  }
  if (Object.keys(parsed.data.models).length === 0) {
    throw new Error(
      `model manifest: ${path} has an empty "models" map — unset GATEWAY_MODEL_MANIFEST instead of enforcing nothing`,
    );
  }
  return parsed.data;
}
