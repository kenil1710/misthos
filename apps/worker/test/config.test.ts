import { describe, expect, it } from "vitest";
import { agentBackend, directUrl, loadEnv } from "../src/config";

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
});
