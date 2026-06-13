'use client';

import { useState } from 'react';

/** Copy-to-clipboard control overlaid on a CodeBlock. The only client JS on docs pages. */
export function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      aria-label="Copy code to clipboard"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable (insecure context) — no-op */
        }
      }}
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}
