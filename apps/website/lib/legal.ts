import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { REPO_URL } from './site';

const REPO_BLOB = `${REPO_URL}/blob/main`;

export interface LegalDoc {
  html: string;
  updated: string;
}

/**
 * Render docs/TERMS.md or docs/PRIVACY.md to HTML at BUILD time, so the legal text on the site
 * stays a single source of truth with the repo (its git history is the changelog). Repo-relative
 * links are rewritten to on-site / GitHub destinations; the leading H1 and the "canonical home"
 * note are stripped (the page supplies its own header). Read happens during `next build`.
 */
export function renderLegal(file: 'TERMS.md' | 'PRIVACY.md'): LegalDoc {
  const raw = readFileSync(join(process.cwd(), '..', '..', 'docs', file), 'utf8');
  const updated = raw.match(/Last updated:\s*([0-9-]+)/)?.[1] ?? '';
  const md = raw
    .replace(/^#[^\n]*\n/, '') // strip leading H1 (page supplies its own)
    .replace(/_Last updated:[\s\S]*?_\s*\n/, '') // strip the canonical-home note
    .replace(/\]\(PRIVACY\.md\)/g, '](/privacy/)')
    .replace(/\]\(TERMS\.md\)/g, '](/terms/)')
    .replace(/\]\(\.\.\/SECURITY\.md\)/g, `](${REPO_BLOB}/SECURITY.md)`);
  const html = marked.parse(md, { async: false }) as string;
  return { html, updated };
}
