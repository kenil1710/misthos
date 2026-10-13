import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, isTransientConnectError, WEB_DB_TIMEOUTS } from "../src/client";

/** A TCP server that accepts connections and never answers: a database that hangs while waking up. */
let server: net.Server;
let port: number;
const sockets = new Set<net.Socket>();
beforeAll(async () => {
  server = net.createServer((s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as net.AddressInfo).port;
});
afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
});

describe("web database timeouts", () => {
  it("are bounded for the web app", () => {
    expect(WEB_DB_TIMEOUTS.connectionTimeoutMillis).toBe(5_000);
    expect(WEB_DB_TIMEOUTS.queryTimeoutMillis).toBe(15_000);
  });

  it("set the pool's connect and query timeouts only when passed (the worker passes none)", async () => {
    const web = createDb("postgres://u:p@127.0.0.1:1/db", WEB_DB_TIMEOUTS).pool;
    expect(web.options.connectionTimeoutMillis).toBe(5_000);
    expect((web.options as { query_timeout?: number }).query_timeout).toBe(15_000);
    const worker = createDb("postgres://u:p@127.0.0.1:1/db", { max: 1 }).pool;
    expect(worker.options.connectionTimeoutMillis).toBeUndefined();
    expect((worker.options as { query_timeout?: number }).query_timeout).toBeUndefined();
    await Promise.all([web.end(), worker.end()]);
  });

  it("a hanging connect fails fast instead of waiting forever, after the connect retries", async () => {
    const { db, pool } = createDb(`postgres://u:p@127.0.0.1:${port}/db`, {
      max: 1,
      connectionTimeoutMillis: 150,
    });
    const started = Date.now();
    const err = await pool.query("select 1").catch((e: unknown) => e);
    const ms = Date.now() - started;
    expect(err).toBeInstanceOf(Error);
    // The timeout is classified as transient, so withConnectRetry tried 3 times (3 × 150 ms + 200 + 600 ms delays).
    expect(isTransientConnectError(err)).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(3 * 150 + 800 - 50);
    expect(ms).toBeLessThan(5_000);
    expect(db).toBeDefined();
    await pool.end();
  });
});
