import { contributors, programs, rounds, users, type DbLike } from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { eq } from "drizzle-orm";
import { Rubric } from "@misthos/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTestProgram, openRoundNow, stillOpen } from "@/lib/explore";
import { openCampaigns } from "@/lib/server/explore";

const NOW = new Date("2026-10-14T12:00:00Z").getTime();
const DAY = 86_400_000;

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let n = 0;

type Opts = {
  slug?: string;
  name?: string;
  status?: "draft" | "active" | "paused" | "archived";
  chain?: string;
  isDemo?: boolean;
  vault?: boolean;
  round?: "open" | "scheduled" | "ended" | "closed" | "none";
  members?: number;
};

async function campaign(o: Opts = {}) {
  const i = ++n;
  const [owner] = await db
    .insert(users)
    .values({ walletAddress: `0x${String(i).padStart(40, "a")}` })
    .returning();
  const [p] = await db
    .insert(programs)
    .values({
      slug: o.slug ?? `campaign-${i}`,
      name: o.name ?? `Campaign ${i}`,
      description: "Pays for posts about Arc",
      ownerUserId: owner!.id,
      chain: o.chain ?? "arc-testnet",
      status: o.status ?? "active",
      isDemo: o.isDemo ?? false,
      vaultAddress: o.vault === false ? null : `0x${String(i).padStart(40, "f")}`,
      rubricJson: Rubric.parse({
        categories: [
          {
            key: "posts",
            name: "Posts",
            description: "Posts about Arc",
            sourceTypes: ["x_post"],
            maxPoints: 10,
            criteria: [{ key: "depth", name: "Depth", description: "Explains how" }],
          },
          {
            key: "articles",
            name: "Articles",
            description: "Long reads",
            sourceTypes: ["article"],
            maxPoints: 30,
            criteria: [{ key: "depth", name: "Depth", description: "Explains how" }],
          },
        ],
      }),
      ratePerPoint: 100_000n,
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
      firstRoundStartsAt: new Date(NOW - DAY),
    })
    .returning();
  const r = o.round ?? "open";
  if (r !== "none")
    await db.insert(rounds).values({
      programId: p!.id,
      number: 1,
      startsAt: new Date(r === "scheduled" ? NOW + DAY : NOW - 2 * DAY),
      endsAt: new Date(r === "ended" ? NOW - DAY : NOW + 3 * DAY),
      status: r === "closed" ? "closed" : "open",
    });
  for (let m = 0; m < (o.members ?? 0); m++) {
    const [u] = await db
      .insert(users)
      .values({ xUserId: `x${i}-${m}`, xHandle: `h${i}m${m}` })
      .returning();
    await db.insert(contributors).values({
      programId: p!.id,
      userId: u!.id,
      xUserId: `x${i}-${m}`,
      xHandle: `h${i}m${m}`,
    });
  }
  return p!;
}

const slugs = async (chain = "arc-testnet") =>
  (await openCampaigns(chain, db, NOW)).map((c) => c.slug);

beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
});
afterEach(async () => {
  await ctx.client.close();
});

describe("explore: which campaigns are listed", () => {
  it("lists only published campaigns whose round is open now", async () => {
    await campaign({ slug: "open-one" });
    await campaign({ slug: "a-draft", status: "draft" });
    await campaign({ slug: "joining-paused", status: "paused" });
    await campaign({ slug: "archived-one", status: "archived" });
    await campaign({ slug: "not-started", round: "scheduled" });
    await campaign({ slug: "past-end", round: "ended" });
    await campaign({ slug: "round-closed", round: "closed" });
    await campaign({ slug: "no-rounds", round: "none" });
    await campaign({ slug: "no-vault", vault: false });
    expect(await slugs()).toEqual(["open-one"]);
  });

  it("hides demo-seed, QA and e2e programs", async () => {
    await campaign({ slug: "real-one" });
    await campaign({ slug: "arc-builders", isDemo: true });
    await campaign({ slug: "qa-1760000000", name: "QA Program 1760000000" });
    await campaign({ slug: "e2e-abc" });
    expect(await slugs()).toEqual(["real-one"]);
  });

  it("shows real campaigns whose name or slug only looks like a test or demo", async () => {
    await campaign({ slug: "testnet-builders", name: "Testnet Builders" });
    await campaign({ slug: "demo-day-creators", name: "Demo Day Creators" });
    await campaign({ slug: "test-pilots", name: "Test Pilots" });
    await campaign({ slug: "qa-guild-weekly", name: "QA Guild", isDemo: true });
    expect((await slugs()).sort()).toEqual([
      "demo-day-creators",
      "test-pilots",
      "testnet-builders",
    ]);
  });

  it("hides an ended campaign", async () => {
    const p = await campaign({ slug: "ended-one" });
    await campaign({ slug: "still-open" });
    await db
      .update(programs)
      .set({ endedAt: new Date(NOW - DAY) })
      .where(eq(programs.id, p.id));
    expect(await slugs()).toEqual(["still-open"]);
  });

  it("follows the network: each network lists only its own campaigns", async () => {
    await campaign({ slug: "on-testnet" });
    await campaign({ slug: "on-mainnet", chain: "arc-mainnet" });
    expect(await slugs("arc-testnet")).toEqual(["on-testnet"]);
    expect(await slugs("arc-mainnet")).toEqual(["on-mainnet"]);
  });

  it("is empty on a network with nothing open", async () => {
    await campaign({ slug: "on-testnet" });
    await campaign({ slug: "mainnet-draft", chain: "arc-mainnet", status: "draft" });
    expect(await slugs("arc-mainnet")).toEqual([]);
  });

  it("carries what a card shows, and nothing about the owner", async () => {
    await campaign({ slug: "small", members: 1 });
    await campaign({ slug: "big", members: 3 });
    const list = await openCampaigns("arc-testnet", db, NOW);
    expect(list.map((c) => [c.slug, c.contributors])).toEqual([
      ["big", 3],
      ["small", 1],
    ]);
    expect(list[0]).toMatchObject({
      paysFor: ["Posts", "Articles"],
      maxPerPiece: 3_000_000n, // 30 points × 0.1 USDC
      round: { number: 1, endsAt: new Date(NOW + 3 * DAY) },
    });
    expect(Object.keys(list[0]!).sort()).toEqual(
      [
        "approvedUnpaid",
        "chain",
        "contributors",
        "description",
        "maxPerPiece",
        "name",
        "paysFor",
        "ratePerPoint",
        "round",
        "slug",
        "vaultAddress",
      ].sort(),
    );
    expect(
      JSON.stringify(list, (_k, v: unknown) => (typeof v === "bigint" ? `${v}` : v)),
    ).not.toMatch(/0xa{30,}/);
  });
});

describe("explore helpers", () => {
  it("recognises test programs by the demo flag or a qa-/e2e- slug only", () => {
    expect(isTestProgram({ slug: "arc-builders", isDemo: true })).toBe(true);
    expect(isTestProgram({ slug: "qa-123" })).toBe(true);
    expect(isTestProgram({ slug: "e2e-run-1" })).toBe(true);
    expect(isTestProgram({ slug: "kency-arc-creators" })).toBe(false);
    expect(isTestProgram({ slug: "testnet-builders" })).toBe(false);
    expect(isTestProgram({ slug: "demo-day-creators" })).toBe(false);
    expect(isTestProgram({ slug: "test-pilots" })).toBe(false);
    expect(isTestProgram({ slug: "qa" })).toBe(false);
    expect(isTestProgram({ slug: "quality-posts" })).toBe(false);
  });
  it("picks the round taking submissions now", () => {
    const r = (s: number, e: number, status = "open") => ({
      startsAt: new Date(NOW + s),
      endsAt: new Date(NOW + e),
      status,
    });
    expect(openRoundNow([r(-DAY, DAY)], NOW)).not.toBeNull();
    expect(openRoundNow([r(DAY, 2 * DAY)], NOW)).toBeNull();
    expect(openRoundNow([r(-2 * DAY, -DAY)], NOW)).toBeNull();
    expect(openRoundNow([r(-DAY, DAY, "closed")], NOW)).toBeNull();
  });
  it("drops a cached entry whose round has since ended", () => {
    const list = [
      { round: { endsAt: new Date(NOW + 1000) } },
      { round: { endsAt: new Date(NOW - 1) } },
    ];
    expect(stillOpen(list, NOW)).toHaveLength(1);
  });
});
