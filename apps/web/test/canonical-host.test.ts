import { createPublicClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet } from "@misthos/shared";
import { CANONICAL_ORIGIN, canonicalRedirects, LEGACY_HOSTS } from "@/lib/canonical-host";
import { verifySiwe } from "@/lib/server/siwe";

describe("canonical host", () => {
  it("redirects every legacy host permanently to https://misthos.world, keeping the path", () => {
    const rules = canonicalRedirects();
    expect(rules.map((r) => r.has[0]!.value).sort()).toEqual(
      ["misthos-iota.vercel.app", "www.misthos.world"].sort(),
    );
    for (const r of rules) {
      expect(r.source).toBe("/:path*");
      expect(r.destination).toBe("https://misthos.world/:path*");
      expect(r.permanent).toBe(true);
    }
    expect(LEGACY_HOSTS).not.toContain(new URL(CANONICAL_ORIGIN).host);
  });
});

describe("origin checks on misthos.world", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, {
      NEXT_PUBLIC_APP_URL: "https://misthos.world",
      DATABASE_URL: "postgres://unused",
      SESSION_SECRET: "x".repeat(32),
      X_CLIENT_ID: "id",
      X_CLIENT_SECRET: "secret",
    });
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const post = (origin: string | null) =>
    new Request("https://misthos.world/api/auth/siwe/nonce", {
      method: "POST",
      headers: origin ? { origin } : {},
    });

  it("accepts the canonical origin and refuses the old and www hosts", async () => {
    const { sameOrigin } = await import("@/lib/server/http");
    expect(sameOrigin(post("https://misthos.world"))).toBe(true);
    expect(sameOrigin(post("https://misthos-iota.vercel.app"))).toBe(false);
    expect(sameOrigin(post("https://www.misthos.world"))).toBe(false);
    expect(sameOrigin(post("http://misthos.world"))).toBe(false);
    expect(sameOrigin(post(null))).toBe(false);
  });

  it("SIWE accepts domain misthos.world and refuses a message made for the old host", async () => {
    const offline = createPublicClient({
      chain: arcTestnet,
      transport: custom({
        request: async () => {
          throw new Error("offline");
        },
      }),
    });
    const now = new Date("2026-10-10T12:00:00Z");
    const account = privateKeyToAccount(generatePrivateKey());
    const make = async (domain: string, uri: string) => {
      const message = createSiweMessage({
        address: account.address,
        chainId: arcTestnet.id,
        domain,
        uri,
        nonce: "abcdef0123456789",
        version: "1",
        issuedAt: now,
        statement: "Sign in to Misthos.",
      });
      return verifySiwe({
        message,
        signature: await account.signMessage({ message }),
        expectedOrigin: "https://misthos.world",
        expectedChainId: arcTestnet.id,
        client: offline,
        consumeNonce: async () => true,
        now,
      });
    };
    expect(await make("misthos.world", "https://misthos.world")).toMatchObject({ ok: true });
    expect(await make("misthos-iota.vercel.app", "https://misthos-iota.vercel.app")).toEqual({
      ok: false,
      error: "wrong_domain",
    });
    expect(await make("misthos.world", "https://misthos-iota.vercel.app")).toEqual({
      ok: false,
      error: "wrong_uri",
    });
  });
});
