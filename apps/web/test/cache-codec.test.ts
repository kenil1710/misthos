import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
const { __test, cached } = await import("@/lib/server/cache");

describe("cache codec (bigint and Date survive the JSON cache)", () => {
  it("round-trips nested bigint, Date and plain values", () => {
    const v = { a: 12n, b: [new Date("2026-10-03T12:00:00Z"), { c: 0n }], d: "x", e: null, f: 1.5 };
    const back = __test.decode<typeof v>(__test.encode(v));
    expect(back).toEqual(v);
    expect(typeof back.a).toBe("bigint");
    expect(back.b[0]).toBeInstanceOf(Date);
  });
  it("wraps a function and keeps its types", async () => {
    const f = cached(async (n: number) => ({ amount: BigInt(n) * 2n, at: new Date(0) }), ["t"], {
      revalidate: 1,
    });
    const r = await f(21);
    expect(r.amount).toBe(42n);
    expect(r.at).toBeInstanceOf(Date);
  });
});
