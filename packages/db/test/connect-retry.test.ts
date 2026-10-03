import { describe, expect, it, vi } from "vitest";
import { isTransientConnectError, withConnectRetry } from "../src/client";

const authTimeout = Object.assign(new Error("Authentication timed out"), { code: "08P01" });

function fakePool(failures: unknown[]) {
  const client = { release: vi.fn() };
  const pool = {
    calls: 0,
    connect: vi.fn(async () => {
      const f = failures[pool.calls++];
      if (f) throw f;
      return client;
    }),
  };
  return { pool, client };
}

describe("withConnectRetry (transient Neon connection errors)", () => {
  it("retries an auth timeout and then connects (promise form)", async () => {
    const { pool, client } = fakePool([authTimeout, authTimeout]);
    const wrapped = withConnectRetry(pool, { delaysMs: [1, 1] });
    await expect((wrapped.connect as unknown as () => Promise<unknown>)()).resolves.toBe(client);
    expect(pool.calls).toBe(3);
  });

  it("works with pg-pool's callback form (used by pool.query)", async () => {
    const { pool, client } = fakePool([authTimeout]);
    const wrapped = withConnectRetry(pool, { delaysMs: [1] });
    const got = await new Promise((resolve, reject) =>
      (wrapped.connect as unknown as (cb: (e: unknown, c: unknown) => void) => void)((e, c) =>
        e ? reject(e) : resolve(c),
      ),
    );
    expect(got).toBe(client);
  });

  it("gives up after the last attempt and never retries real errors", async () => {
    const a = fakePool([authTimeout, authTimeout, authTimeout]);
    await expect(
      (withConnectRetry(a.pool, { delaysMs: [1] }).connect as unknown as () => Promise<unknown>)(),
    ).rejects.toThrow("Authentication timed out");
    expect(a.pool.calls).toBe(3);

    const bad = Object.assign(new Error("password authentication failed"), { code: "28P01" });
    const b = fakePool([bad]);
    await expect(
      (withConnectRetry(b.pool, { delaysMs: [1] }).connect as unknown as () => Promise<unknown>)(),
    ).rejects.toThrow("password authentication failed");
    expect(b.pool.calls).toBe(1);
  });

  it("classifies errors", () => {
    expect(isTransientConnectError(authTimeout)).toBe(true);
    expect(isTransientConnectError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(
      true,
    );
    expect(isTransientConnectError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isTransientConnectError(Object.assign(new Error("syntax"), { code: "42601" }))).toBe(
      false,
    );
  });
});

describe("createDb (idle connection errors)", () => {
  it("a dropped idle connection is logged, not thrown (no process crash)", async () => {
    const { createDb } = await import("../src/client");
    const { pool } = createDb("postgresql://u:p@127.0.0.1:1/db", { max: 1 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      pool.emit(
        "error",
        Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
        {} as never,
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ECONNRESET"));
    warn.mockRestore();
    await pool.end();
  });
});
