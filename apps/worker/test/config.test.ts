import { describe, expect, it } from "vitest";
import { agentBackend, directUrl, loadEnv, mainnetAgent } from "../src/config";

const base = {
  DATABASE_URL: "postgresql://u:p@ep-x-pooler.c-7.us-east-2.aws.neon.tech/db?sslmode=require",
  X_BEARER_TOKEN: "x",
  ANTHROPIC_API_KEY: "k",
  AGENT_PRIVATE_KEY: `0x${"1".repeat(64)}`,
};

describe("worker config", () => {
  it("derives Neon's direct endpoint for pg-boss", () => {
    expect(directUrl(loadEnv(base))).toBe(
      "postgresql://u:p@ep-x.c-7.us-east-2.aws.neon.tech/db?sslmode=require",
    );
    expect(directUrl(loadEnv({ ...base, DATABASE_URL_DIRECT: "postgresql://direct/db" }))).toBe(
      "postgresql://direct/db",
    );
  });

  it("picks Circle when configured, else the EOA fallback, and names what's missing", () => {
    const circle = {
      CIRCLE_API_KEY: "TEST_API_KEY:x",
      CIRCLE_ENTITY_SECRET: "s",
      CIRCLE_AGENT_WALLET_ID: "w",
      CIRCLE_AGENT_WALLET_ADDRESS: `0x${"a".repeat(40)}`,
    };
    expect(agentBackend(loadEnv({ ...base, ...circle }))).toBe("circle");
    expect(agentBackend(loadEnv(base))).toBe("eoa");
    expect(agentBackend(loadEnv({ ...base, ...circle, AGENT_BACKEND: "eoa" }))).toBe("eoa");
    expect(() => agentBackend(loadEnv({ ...base, AGENT_BACKEND: "circle" }))).toThrow(
      /CIRCLE_ENTITY_SECRET/,
    );
    const { AGENT_PRIVATE_KEY: _drop, ...noKey } = base;
    expect(() => agentBackend(loadEnv(noKey))).toThrow(/AGENT_PRIVATE_KEY/);
  });

  it("refuses to start without the judge or signer, naming keys but never values", () => {
    expect(() => loadEnv({ ...base, ANTHROPIC_API_KEY: "" })).toThrow(/ANTHROPIC_API_KEY/);
    try {
      loadEnv({ ...base, AGENT_PRIVATE_KEY: "0xsecretvalue" });
    } catch (e) {
      expect((e as Error).message).toMatch(/AGENT_PRIVATE_KEY/);
      expect((e as Error).message).not.toContain("secretvalue");
    }
  });

  it("Arc Mainnet agent: on only when fully configured with a LIVE key; anything else is off, never a crash", () => {
    expect(mainnetAgent(loadEnv(base))).toMatchObject({ agent: null, reason: /not configured/ });
    const main = {
      CIRCLE_ENTITY_SECRET: "s",
      CIRCLE_LIVE_API_KEY: "LIVE_API_KEY:x",
      CIRCLE_MAINNET_AGENT_WALLET_ID: "w",
      CIRCLE_MAINNET_AGENT_WALLET_ADDRESS: `0x${"b".repeat(40)}`,
    };
    expect(mainnetAgent(loadEnv({ ...base, ...main }))).toMatchObject({
      agent: { apiKey: "LIVE_API_KEY:x", entitySecret: "s", walletId: "w" },
    });
    // A TEST key, a half-set agent or the testnet wallet: mainnet stays off and the worker still loads its env.
    const off = (extra: Record<string, string | undefined>) =>
      mainnetAgent(loadEnv({ ...base, ...main, ...extra }));
    expect(off({ CIRCLE_LIVE_API_KEY: "TEST_API_KEY:x" })).toMatchObject({
      agent: null,
      reason: /isn't a Circle production key/,
    });
    expect(off({ CIRCLE_MAINNET_AGENT_WALLET_ID: undefined })).toMatchObject({
      agent: null,
      reason: "half-configured; missing CIRCLE_MAINNET_AGENT_WALLET_ID",
    });
    expect(off({ CIRCLE_ENTITY_SECRET: undefined })).toMatchObject({
      reason: /missing CIRCLE_MAINNET_ENTITY_SECRET/,
    });
    expect(off({ CIRCLE_MAINNET_AGENT_WALLET_ADDRESS: "nope" })).toMatchObject({ agent: null });
    expect(
      off({ CIRCLE_AGENT_WALLET_ADDRESS: `0x${"B".repeat(40)}`, CIRCLE_AGENT_WALLET_ID: "t" }),
    ).toMatchObject({ agent: null, reason: /is the testnet one/ });
    // Reasons name variables, never values.
    expect(JSON.stringify(off({ CIRCLE_LIVE_API_KEY: "TEST_API_KEY:secretvalue" }))).not.toContain(
      "secretvalue",
    );
  });

  it("the worker's primary network is always Arc Testnet (a testnet key never serves mainnet)", () => {
    expect(loadEnv(base).NEXT_PUBLIC_CHAIN).toBe("arc-testnet");
    expect(() => loadEnv({ ...base, NEXT_PUBLIC_CHAIN: "arc-mainnet" })).toThrow(/arc-testnet/);
  });
});
