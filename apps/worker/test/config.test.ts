import { describe, expect, it } from "vitest";
import { directUrl, loadEnv } from "../src/config";

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
