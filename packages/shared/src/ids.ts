import { keccak256, toBytes, type Hex } from 'viem';

/**
 * Deterministic, byte-stable JSON serialization: object keys are sorted
 * recursively, arrays keep their order, and there is no insignificant
 * whitespace. Two structurally-equal values always produce identical bytes
 * regardless of key insertion order or platform — this is what makes jobId
 * derivation reproducible across the gateway, node, and tests.
 */
export function canonicalStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') + '}'
  );
}

/** keccak256 of a UTF-8 string, returned as a 0x-prefixed 32-byte hex. */
export function hashText(text: string): Hex {
  return keccak256(toBytes(text));
}

/** keccak256 of the canonical serialization of a value. */
export function hashCanonical(value: unknown): Hex {
  return hashText(canonicalStringify(value));
}
