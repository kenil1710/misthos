import "server-only";
import { unstable_cache } from "next/cache";

/**
 * `unstable_cache` stores JSON, which can't hold the bigint amounts and Dates our queries return. This encodes them
 * on the way in and revives them on the way out, so cached functions keep their exact types.
 */
function encode(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, v: unknown) {
    const raw = this[key];
    if (raw instanceof Date) return { $d: raw.toISOString() };
    if (typeof v === "bigint") return { $b: v.toString() };
    return v;
  });
}

function decode<T>(text: string): T {
  return JSON.parse(text, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (typeof o.$d === "string" && Object.keys(o).length === 1) return new Date(o.$d);
      if (typeof o.$b === "string" && Object.keys(o).length === 1) return BigInt(o.$b);
    }
    return v;
  }) as T;
}

/** Cache a read for `revalidate` seconds (shared by every visitor), keeping bigint and Date values intact. */
export function cached<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  key: string[],
  opts: { revalidate: number; tags?: string[] },
): (...args: A) => Promise<R> {
  const inner = unstable_cache(async (...args: A) => encode(await fn(...args)), key, opts);
  return async (...args: A) => decode<R>(await inner(...args));
}

export const __test = { encode, decode };
