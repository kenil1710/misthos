import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { testDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof testDb>>;
let ctx: Ctx;

beforeEach(async () => {
  ctx = await testDb();
});
afterEach(async () => {
  await ctx.client.close();
});

async function seedProgram(slug = "arc-builders") {
  const [owner] = await ctx.db
    .insert(s.users)
    .values({
      walletAddress: `0x${Buffer.from(slug).toString("hex").padEnd(40, "0").slice(0, 40)}`,
    })
    .returning();
  const [program] = await ctx.db
    .insert(s.programs)
    .values({
      slug,
      name: "Arc Builders",
      description: "Pays for Arc content",
      ownerUserId: owner!.id,
      chain: "arc-testnet",
      rubricJson: { categories: [], generalRules: "" },
      ratePerPoint: 1_000_000n,
      limitsJson: {
        maxPerPayout: "1",
        maxPerRound: "1",
        maxPerDay: "1",
        autoApproveThreshold: "0",
        payeeCooldownSeconds: 0,
        maxAutoApproveItem: "0",
      },
      autoApproveConfidence: 0.8,
      roundLengthDays: 14,
      firstRoundStartsAt: new Date("2026-10-05T00:00:00Z"),
    })
    .returning();
  return { owner: owner!, program: program! };
}

async function seedContributor(programId: string, n: number, wallet?: string) {
  const [u] = await ctx.db
    .insert(s.users)
    .values({ xUserId: `x${n}`, xHandle: `h${n}` })
    .returning();
  const [c] = await ctx.db
    .insert(s.contributors)
    .values({ programId, userId: u!.id, xUserId: `x${n}`, xHandle: `h${n}`, walletAddress: wallet })
    .returning();
  return c!;
}

const pgError = (e: unknown) => {
  const err = e as { cause?: { message?: string; code?: string }; message?: string; code?: string };
  return `${err.code ?? err.cause?.code ?? ""} ${err.message ?? ""} ${err.cause?.message ?? ""}`;
};

describe("migrations", () => {
  it("enable pg_trgm and its similarity()", async () => {
    const r = await ctx.client.query<{ sim: number }>(
      "select similarity('arc gas model thread', 'arc gas model threads') as sim",
    );
    expect(r.rows[0]!.sim).toBeGreaterThan(0.7);
    const idx = await ctx.client.query(
      "select 1 from pg_indexes where indexname = 'fetched_resources_content_trgm_idx'",
    );
    expect(idx.rows).toHaveLength(1);
  });
});

describe("audit_events", () => {
  it("accepts inserts but blocks update, delete and truncate", async () => {
    const [ev] = await ctx.db
      .insert(s.auditEvents)
      .values({ actor: "system", action: "test", entity: "x", entityId: "1", dataJson: { a: 1 } })
      .returning();
    expect(ev!.id).toBeTruthy();

    await expect(ctx.db.update(s.auditEvents).set({ action: "tampered" })).rejects.toSatisfy((e) =>
      pgError(e).includes("append-only"),
    );
    await expect(ctx.db.delete(s.auditEvents)).rejects.toSatisfy((e) =>
      pgError(e).includes("append-only"),
    );
    await expect(ctx.db.execute(sql`truncate audit_events`)).rejects.toSatisfy((e) =>
      pgError(e).includes("append-only"),
    );
    const rows = await ctx.db.select().from(s.auditEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("test");
  });
});

describe("contributors", () => {
  it("allows one membership per X account per program", async () => {
    const { program } = await seedProgram();
    const c = await seedContributor(program.id, 1);
    await expect(
      ctx.db
        .insert(s.contributors)
        .values({ programId: program.id, userId: c.userId, xUserId: "x1", xHandle: "h1" }),
    ).rejects.toSatisfy((e) => pgError(e).includes("contributors_program_x_uq"));
  });

  it("allows one payout wallet per program but many unlinked contributors", async () => {
    const { program } = await seedProgram();
    const w = `0x${"b".repeat(40)}`;
    await seedContributor(program.id, 1, w);
    await seedContributor(program.id, 2); // NULL wallets don't collide
    await seedContributor(program.id, 3);
    await expect(seedContributor(program.id, 4, w)).rejects.toSatisfy((e) =>
      pgError(e).includes("contributors_program_wallet_uq"),
    );
    const { program: other } = await seedProgram("other-program");
    await expect(seedContributor(other.id, 5, w)).resolves.toBeTruthy();
  });
});

describe("submissions", () => {
  it("rejects a contributor resubmitting the same resource, keeps cross-contributor duplicates", async () => {
    const { program } = await seedProgram();
    const [round] = await ctx.db
      .insert(s.rounds)
      .values({ programId: program.id, number: 1, startsAt: new Date(), endsAt: new Date() })
      .returning();
    const a = await seedContributor(program.id, 1);
    const b = await seedContributor(program.id, 2);
    const base = {
      programId: program.id,
      roundId: round!.id,
      url: "https://x.com/a/status/1",
      sourceType: "x_post" as const,
      resourceId: "1",
    };
    await ctx.db.insert(s.submissions).values({ ...base, contributorId: a.id });
    await expect(
      ctx.db.insert(s.submissions).values({ ...base, contributorId: a.id }),
    ).rejects.toSatisfy((e) => pgError(e).includes("submissions_contributor_resource_live_uq"));
    await expect(
      ctx.db.insert(s.submissions).values({ ...base, contributorId: b.id }),
    ).resolves.toBeTruthy();
  });
});

describe("money columns", () => {
  it("round-trip bigint base units beyond 2^53", async () => {
    const { program } = await seedProgram();
    const big = 9_007_199_254_740_993n; // 2^53 + 1
    const [r] = await ctx.db
      .insert(s.rounds)
      .values({
        programId: program.id,
        number: 1,
        startsAt: new Date(),
        endsAt: new Date(),
        totalAmount: big,
      })
      .returning();
    expect(r!.totalAmount).toBe(big);
    const [fresh] = await ctx.db
      .insert(s.rounds)
      .values({ programId: program.id, number: 2, startsAt: new Date(), endsAt: new Date() })
      .returning();
    expect(fresh!.totalAmount).toBe(0n);
  });
});
