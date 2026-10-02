import { createPublicClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { describe, expect, it, vi } from "vitest";
import { arcTestnet } from "@misthos/shared";
import { verifySiwe } from "@/lib/server/siwe";

const offline = createPublicClient({
  chain: arcTestnet,
  transport: custom({
    request: async () => {
      throw new Error("offline");
    },
  }),
});
const ORIGIN = "https://misthos.example";
const now = new Date("2026-10-02T12:00:00Z");

async function signed(overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = createSiweMessage({
    address: account.address,
    chainId: 5042002,
    domain: "misthos.example",
    uri: ORIGIN,
    nonce: "abcdef0123456789",
    version: "1",
    issuedAt: now,
    statement: "Sign in to Misthos.",
    ...overrides,
  });
  return { account, message, signature: await account.signMessage({ message }) };
}

const run = (m: Awaited<ReturnType<typeof signed>>, consume = vi.fn(async () => true)) =>
  verifySiwe({
    message: m.message,
    signature: m.signature,
    expectedOrigin: ORIGIN,
    expectedChainId: 5042002,
    client: offline,
    consumeNonce: consume,
    now,
  });

describe("verifySiwe", () => {
  it("accepts a valid sign-in and consumes the nonce once", async () => {
    const m = await signed();
    const consume = vi.fn(async () => true);
    const r = await run(m, consume);
    expect(r).toEqual({ ok: true, address: m.account.address.toLowerCase() });
    expect(consume).toHaveBeenCalledWith("abcdef0123456789");
  });

  it("rejects a replayed nonce", async () => {
    expect(
      await run(
        await signed(),
        vi.fn(async () => false),
      ),
    ).toEqual({ ok: false, error: "nonce_used" });
  });

  it("rejects another domain (phishing-site relay)", async () => {
    expect(await run(await signed({ domain: "evil.example" }))).toEqual({
      ok: false,
      error: "wrong_domain",
    });
  });

  it("rejects another uri origin", async () => {
    expect(await run(await signed({ uri: "https://evil.example/login" }))).toEqual({
      ok: false,
      error: "wrong_uri",
    });
  });

  it("rejects another chain", async () => {
    expect(await run(await signed({ chainId: 1 }))).toEqual({ ok: false, error: "wrong_chain" });
  });

  it("rejects stale or expired messages", async () => {
    expect(await run(await signed({ issuedAt: new Date(now.getTime() - 11 * 60_000) }))).toEqual({
      ok: false,
      error: "stale",
    });
    expect(await run(await signed({ expirationTime: new Date(now.getTime() - 1000) }))).toEqual({
      ok: false,
      error: "stale",
    });
  });

  it("rejects a signature from a different key and does not burn the nonce", async () => {
    const m = await signed();
    const other = privateKeyToAccount(generatePrivateKey());
    const consume = vi.fn(async () => true);
    const r = await run(
      { ...m, signature: await other.signMessage({ message: m.message }) },
      consume,
    );
    expect(r).toEqual({ ok: false, error: "bad_signature" });
    expect(consume).not.toHaveBeenCalled();
  });

  it("rejects malformed messages", async () => {
    const m = await signed();
    expect(await run({ ...m, message: "hello" })).toEqual({ ok: false, error: "malformed" });
  });
});
