import { describe, expect, it } from "vitest";
import { auditEvents, programs, users } from "../src/schema";
import { markProgramsDemoSince } from "../src/mark-demo";
import type { DbLike } from "../src/client";
import { testDb } from "./helpers";

describe("markProgramsDemoSince", () => {
  it("flags only programs created since the cutoff, audits each, and is idempotent", async () => {
    const { db: raw, client } = await testDb();
    const db = raw as unknown as DbLike;
    const [owner] = await db
      .insert(users)
      .values({ walletAddress: "0x00000000000000000000000000000000000000aa" })
      .returning();
    const base = {
      name: "P",
      description: "d",
      ownerUserId: owner!.id,
      chain: "arc-testnet",
      rubricJson: { categories: [], generalRules: "" },
      ratePerPoint: 1n,
      limitsJson: {
        maxPerPayout: "1",
        maxPerRound: "1",
        maxPerDay: "1",
        autoApproveThreshold: "0",
        payeeCooldownSeconds: 0,
        maxAutoApproveItem: "0",
      },
      autoApproveConfidence: 0.8,
      roundLengthDays: 7,
      firstRoundStartsAt: new Date(),
    };
    await db.insert(programs).values([
      { ...base, slug: "yesterday", createdAt: new Date("2026-10-01T12:00:00Z") },
      { ...base, slug: "today-a", createdAt: new Date("2026-10-02T09:00:00Z") },
      { ...base, slug: "today-b", createdAt: new Date("2026-10-02T15:00:00Z") },
    ]);
    const marked = await markProgramsDemoSince(db, new Date("2026-10-02T00:00:00Z"));
    expect(marked.map((m) => m.slug).sort()).toEqual(["today-a", "today-b"]);
    const all = await db.select({ slug: programs.slug, isDemo: programs.isDemo }).from(programs);
    expect(Object.fromEntries(all.map((p) => [p.slug, p.isDemo]))).toEqual({
      yesterday: false,
      "today-a": true,
      "today-b": true,
    });
    expect((await db.select().from(auditEvents)).map((e) => e.action)).toEqual([
      "program.marked_demo",
      "program.marked_demo",
    ]);
    expect(await markProgramsDemoSince(db, new Date("2026-10-02T00:00:00Z"))).toEqual([]);
    await client.close();
  });
});
