import { keccak256, toBytes, type Hex } from "viem";

/**
 * Canonical JSON: object keys sorted recursively, no whitespace, bigint → decimal string, Date → ISO string,
 * undefined properties dropped. Anyone can rebuild the exact bytes from the published record and re-hash them.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(v: unknown): unknown {
  if (v === null) return null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("canonicalize: non-finite number");
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : normalize(x)));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = normalize(x);
    }
    return out;
  }
  return v;
}

export const hashCanonical = (value: unknown): Hex => keccak256(toBytes(canonicalize(value)));
export const hashText = (text: string): Hex => keccak256(toBytes(text));
