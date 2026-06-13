import type { Highlighted } from '../lib/highlight';
import { CopyButton } from './CopyButton';

/**
 * Renders a build-time-highlighted snippet (see lib/highlight.ts). Sync component — the async
 * Shiki work happens in the page via highlight() — so it composes cleanly in JSX and only the
 * small CopyButton hydrates on the client.
 */
export function CodeBlock({ block }: { block: Highlighted }) {
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span className="codeblock-lang">{block.title ?? block.lang}</span>
        <CopyButton code={block.code} />
      </div>
      <div className="codeblock-body" dangerouslySetInnerHTML={{ __html: block.html }} />
    </div>
  );
}
