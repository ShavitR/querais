/** Shared formatting helpers for the views. */

/** wei (decimal string) → QAIS with 4 dp. Number() is fine for display precision. */
export function fmtQais(wei: string | null | undefined): string {
  if (wei == null) return '–';
  return (Number(wei) / 1e18).toFixed(4);
}

/** 0xabcd…1234 */
export function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/** Block-explorer address link for known chains; null for local/unknown (no link). */
export function explorerAddr(chainId: number | undefined, addr: string): string | null {
  switch (chainId) {
    case 421614:
      return `https://sepolia.arbiscan.io/address/${addr}`;
    case 42161:
      return `https://arbiscan.io/address/${addr}`;
    default:
      return null;
  }
}

/** Unix-ms → short local time string. */
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString();
}
