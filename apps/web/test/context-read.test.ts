import { programContexts, users, type DbLike } from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { contextInputHash } from "@misthos/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestContextRead } from "@/lib/server/context";

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let ownerId: string;
beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
  const [u] = await db
    .insert(users)
    .values({ walletAddress: "0x" + "b".repeat(40) })
    .returning();
  ownerId = u!.id;
});
afterEach(async () => {
  await ctx.client.close();
});

const input = {
  about: "CronPay is non-custodial USDC escrow payment infrastructure for remote teams on Arc.",
  links: ["https://cronpay.co/", "https://x.com/cronpay_"],
  mustInclude: [],
};
const understanding = { summary: "Escrow on Arc.", keyFacts: [], onTopic: [], offTopic: [] };

describe("Read it: the one-day cache", () => {
  it("never answers with a saved version, even one with the same text (it may hold nothing)", async () => {
    await db.insert(programContexts).values({
      ownerUserId: ownerId,
      version: 1,
      about: input.about,
      linksJson: input.links,
      status: "ready",
      understandingJson: null,
      inputHash: contextInputHash(input),
    });
    const enqueue = vi.fn(async () => {});
    const res = await requestContextRead(db, { ownerUserId: ownerId, input }, enqueue);
    expect(res.cached).toBe(false);
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("reuses a real read from today that has a result, and skips one that came back empty", async () => {
    const [empty] = await db
      .insert(programContexts)
      .values({
        ownerUserId: ownerId,
        about: input.about,
        linksJson: input.links,
        status: "ready",
        understandingJson: null,
        inputHash: contextInputHash(input),
      })
      .returning();
    const enqueue = vi.fn(async () => {});
    const first = await requestContextRead(db, { ownerUserId: ownerId, input }, enqueue);
    expect(first.cached).toBe(false);
    expect(first.id).not.toBe(empty!.id);

    const [good] = await db
      .insert(programContexts)
      .values({
        ownerUserId: ownerId,
        about: input.about,
        linksJson: input.links,
        status: "ready",
        understandingJson: understanding,
        inputHash: contextInputHash(input),
      })
      .returning();
    const second = await requestContextRead(db, { ownerUserId: ownerId, input }, enqueue);
    expect(second).toEqual({ id: good!.id, cached: true });
  });
});
