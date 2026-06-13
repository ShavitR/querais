import { codeToHtml } from 'shiki';

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface Highlighted {
  html: string;
  code: string;
  lang: string;
  title?: string;
}

/**
 * Syntax-highlight a snippet at BUILD time (Shiki runs during `next build`; nothing reaches the
 * client). Returns the highlighted HTML plus the raw code for the copy button. Falls back to
 * escaped plain text if the language is unknown or highlighting throws, so a sample never breaks
 * the build. Called from async page components; the result is handed to the sync <CodeBlock>.
 */
export async function highlight(code: string, lang = 'bash', title?: string): Promise<Highlighted> {
  const src = code.replace(/^\n+|\n+$/g, '');
  let html: string;
  try {
    html = await codeToHtml(src, { lang, theme: 'github-dark-default' });
  } catch {
    html = `<pre class="shiki"><code>${escape(src)}</code></pre>`;
  }
  return { html, code: src, lang, title };
}
