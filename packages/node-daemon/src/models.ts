/**
 * Model-name helpers that tolerate Ollama's implicit `:latest` tag.
 *
 * Ollama stores an untagged model (`llama3.2`) as `llama3.2:latest`. Without this,
 * an operator who sets `DAEMON_MODELS=llama3.2` (as the docs/.env.example show) would
 * hit "No models available to serve" even with the model pulled, because the served
 * filter and digest lookup did exact string matches against the backend's tagged ids.
 */

/** A model id with Ollama's implicit `:latest` tag made explicit. */
export function withDefaultTag(model: string): string {
  return model.includes(':') ? model : `${model}:latest`;
}

/**
 * Pick which configured models to serve given what the backend actually reports,
 * matching a bare name against its `:latest` form (and vice-versa). Returns the
 * CONFIGURED names — what we advertise and requesters ask for — not the backend's
 * tagged ids. With no configured models, serve everything the backend reports.
 */
export function selectServedModels(configured: string[], available: string[]): string[] {
  if (!configured.length) return available;
  const have = new Set(available);
  return configured.filter((m) => have.has(m) || have.has(withDefaultTag(m)));
}

/** Look up a model's digest, tolerating the bare-vs-`:latest` naming difference. */
export function digestFor(model: string, digests: Record<string, string>): string | undefined {
  return digests[model] ?? digests[withDefaultTag(model)];
}
