import {
  auditEvents,
  contributors,
  decisions,
  payouts,
  programMembers,
  programs,
  rounds,
  submissions,
  users,
  type DbLike,
} from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { Rubric } from "@misthos/shared";
import { asc, eq } from "drizzle-orm";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChainError, type AgentExecutor } from "../src/chain/executor";
import { eoaSigner } from "../src/record";
import { contributorIdBytes32, roundIdBytes32 } from "../src/rounds/ids";
import { runRound, syncPayee, type RoundDeps } from "../src/rounds/job";
import type { Fetchers } from "../src/pipeline";
import type { Resource } from "../src/types";
import { FakeVault } from "./fake-vault";

const U = 1_000_000n;
const VAULT = "0x000000000000000000000000000000000000f00d" as Address;
const RUBRIC = Rubric.parse({
  categories: [
    {
      key: "posts",
      name: "Posts",
      description: "Posts about Arc",
      sourceTypes: ["x_post"],
      maxPoints: 10,
      criteria: [{ key: "depth", name: "Depth", description: "Explains how" }],
    },
  ],
});

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let programId: string;
let round1: string;
const people: Record<string, { id: string; xUserId: string; wallet: Address }> = {};
const deleted = new Set<string>();

const resourceFor = (id: string, authorId: string): Resource => ({
  sourceType: "x_post",
  resourceId: id,
  url: `https://x.com/i/web/status/${id}`,
  timestamp: "2026-10-06T00:00:00.000Z",
  timestampKind: "posted",
  title: null,
  text: "Arc pays gas in USDC.",
  author: { id: authorId, handle: "h", name: null, createdAt: null, followers: 10 },
  x: {
    isRepost: false,
    isReply: false,
    isQuote: false,
    likes: 1,
    reposts: 0,
    replies: 0,
    quotes: 0,
    impressions: 10,
    lang: "en",
  },
});

/** Re-check fetcher: post id encodes its author ("<authorXid>-<n>"); ids in `deleted` are gone. */
const fetchers: Fetchers = {
  x: async (id) =>
    deleted.has(id)
      ? { outcome: { status: "not_found", detail: "The post was deleted." }, usage: [] }
      : {
          outcome: { status: "ok", resource: resourceFor(id, id.split("-")[0]!) },
          usage: [{ provider: "x", endpoint: "GET /2/tweets/:id", units: 1, estCostUsd: 0.015 }],
        },
  githubPr: async () => {
    throw new Error("unused");
  },
  githubCommit: async () => {
    throw new Error("unused");
  },
  article: async () => {
    throw new Error("unused");
  },
};

beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
  deleted.clear();
  const [owner] = await db
    .insert(users)
    .values({ walletAddress: "0x00000000000000000000000000000000000000aa" })
    .returning();
  const [p] = await db
    .insert(programs)
    .values({
      slug: "rounds",
      name: "Rounds",
      description: "Round tests",
      ownerUserId: owner!.id,
      chain: "arc-testnet",
      status: "active",
      vaultAddress: VAULT,
      rubricJson: RUBRIC,
      ratePerPoint: U,
      limitsJson: {
        maxPerPayout: String(5n * U),
        maxPerRound: String(12n * U),
        maxPerDay: String(50n * U),
        autoApproveThreshold: String(6n * U),
        payeeCooldownSeconds: 0,
        maxAutoApproveItem: String(5n * U),
      },
      autoApproveConfidence: 0.8,
      roundLengthDays: 7,
      firstRoundStartsAt: new Date("2026-10-05T00:00:00Z"),
    })
    .returning();
  programId = p!.id;
  await db.insert(programMembers).values({ programId, userId: owner!.id, role: "owner" });
  const [r] = await db
    .insert(rounds)
    .values({
      programId,
      number: 1,
      startsAt: new Date("2026-10-05T00:00:00Z"),
      endsAt: new Date("2026-10-12T00:00:00Z"),
    })
    .returning();
  round1 = r!.id;
  for (const [name, xid, w] of [
    ["alice", "1001", "a1"],
    ["bob", "1002", "b2"],
    ["carol", "1003", "c3"],
  ] as const) {
    const [u] = await db.insert(users).values({ xUserId: xid, xHandle: name }).returning();
    const wallet = `0x${w.padStart(40, "0")}` as Address;
    const [c] = await db
      .insert(contributors)
      .values({
        programId,
        userId: u!.id,
        xUserId: xid,
        xHandle: name,
        walletAddress: wallet,
        walletVerifiedAt: new Date(),
      })
      .returning();
    people[name] = { id: c!.id, xUserId: xid, wallet };
  }
});
afterEach(async () => {
  await ctx.client.close();
});

let n = 0;
/** An approved submission with a signed-looking agent decision. */
async function approved(who: keyof typeof people, amount: bigint, roundId = round1) {
  const person = people[who]!;
  const rid = `${person.xUserId}-${++n}`;
  const [s] = await db
    .insert(submissions)
    .values({
      programId,
      roundId,
      contributorId: person.id,
      url: `https://x.com/i/web/status/${rid}`,
      sourceType: "x_post",
      resourceId: rid,
      status: "approved",
      amount,
      createdAt: new Date(Date.UTC(2026, 9, 6, 0, n)),
    })
    .returning();
  const record = {
    schema: "misthos.decision/v1",
    submission: { id: s!.id },
    contributor: { wallet: person.wallet },
    round: {},
    flags: [],
    decision: { action: "approve", amount: String(amount) },
    decidedBy: { type: "agent" },
    summary: "ok",
    decidedAt: "2026-10-06T00:00:00Z",
  };
  await db.insert(decisions).values({
    submissionId: s!.id,
    flagsJson: [],
    action: "approve",
    amount,
    summary: "Approved.",
    decisionJson: JSON.stringify(record),
    decisionHash: keccak256(toBytes(`decision:${s!.id}`)),
    signature: "0x00",
    signerAddress: "0x0000000000000000000000000000000000000001",
    ruleVersion: "rules-v2",
    decidedBy: "agent",
  });
  return s!.id;
}

function deps(vault: FakeVault, executor: AgentExecutor = vault): RoundDeps {
  return {
    db,
    fetchers,
    judge: null,
    signer: eoaSigner(generatePrivateKey()),
    chainId: 5042002,
    reader: vault,
    executor,
    now: () => new Date("2026-10-12T00:00:01Z"),
  };
}
const fake = (o: Partial<FakeVault["lim"]> = {}, balance = 100n * U) =>
  new FakeVault(
    {
      maxPerPayout: 5n * U,
      maxPerRound: 12n * U,
      maxPerDay: 50n * U,
      autoApproveThreshold: 6n * U,
      payeeCooldown: 0n,
      ...o,
    },
    balance,
  );
const roundRow = async (id = round1) =>
  (await db.select().from(rounds).where(eq(rounds.id, id)))[0]!;
const actions = async () =>
  (await db.select().from(auditEvents).orderBy(asc(auditEvents.createdAt))).map((a) => a.action);

/**
 * Independent audit (docs/INDEPENDENT_AUDIT.md): the money-flow reproductions, flipped into regression tests once the
 * fixes landed. Each test is the original attack; it now asserts the safe outcome.
 */
describe("AUDIT money flow (regressions)", () => {
  it("F-01: a worker killed right after executeRound landed never pays twice (the chain decides, not memory)", async () => {
    const v = fake();
    const s = await approved("alice", 2n * U);
    // Worker dies right after executeRound lands, before the DB write (e.g. OOM/redeploy).
    let crash = true;
    const crashing: AgentExecutor = {
      kind: "eoa",
      address: v.address,
      send: async (call) => {
        const res = await v.send(call);
        if (crash && call.label.startsWith("executeRound")) {
          crash = false;
          throw new Error("process killed");
        }
        return res;
      },
    };
    await expect(runRound(deps(v, crashing), round1)).rejects.toThrow(/killed/);
    expect(v.balances.get(people.alice!.wallet.toLowerCase())).toBe(2n * U); // paid once on-chain
    // Restart: the executor forgot every idempotency key (EOA memory, or an expired Circle record).
    v.sentKeys.clear();
    const out = await runRound(deps(v, crashing), round1);
    // The job reads the vault first: the round already executed, so it records it without sending anything.
    expect(out).toMatchObject({ status: "executed" });
    expect(v.calls.filter((c) => c === "executeRound")).toHaveLength(1);
    expect((await db.select().from(submissions).where(eq(submissions.id, s)))[0]).toMatchObject({
      status: "paid",
    });
    expect((await roundRow()).status).toBe("executed");
    expect(await actions()).toContain("round.executed");
    // The next round has nothing of Alice's to pay again.
    const next = (await db.select().from(rounds).where(eq(rounds.programId, programId))).find(
      (r) => r.number === 2,
    )!;
    const later = { ...deps(v, v), now: () => new Date("2026-10-19T00:00:02Z") };
    expect(await runRound(later, next.id)).toMatchObject({ status: "nothing_to_pay" });
    expect(v.balances.get(people.alice!.wallet.toLowerCase())).toBe(2n * U); // still paid once
  });

  it("F-01: a non-retryable error after execution records the payment instead of releasing the items", async () => {
    const v = fake();
    const s = await approved("alice", 2n * U);
    // executeRound lands, then the executor reports a hard failure (e.g. Circle 4xx on the status poll).
    const lying: AgentExecutor = {
      kind: v.kind,
      address: v.address,
      send: async (call) => {
        const res = await v.send(call);
        if (call.label.startsWith("executeRound"))
          throw new ChainError("executeRound failed: 400 from the wallet provider", false);
        return res;
      },
    };
    expect(await runRound(deps(v, lying), round1)).toMatchObject({ status: "executed" });
    expect((await db.select().from(submissions).where(eq(submissions.id, s)))[0]).toMatchObject({
      status: "paid",
    });
    expect(v.balances.get(people.alice!.wallet.toLowerCase())).toBe(2n * U);
  });

  it("F-02: a wallet change while a round awaits approval waits for the round; everyone is paid", async () => {
    const v = fake();
    await approved("alice", 4n * U);
    await approved("bob", 4n * U);
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "awaiting_approval" });
    // Bob links a new wallet in the web app → syncPayee job.
    const bobNew = "0x00000000000000000000000000000000000000b9" as Address;
    await db
      .update(contributors)
      .set({ walletAddress: bobNew, walletVerifiedAt: new Date() })
      .where(eq(contributors.id, people.bob!.id));
    const registrations = v.calls.filter((c) => c === "registerPayee").length;
    expect(await syncPayee(deps(v), people.bob!.id)).toEqual({ status: "deferred" });
    expect(v.calls.filter((c) => c === "registerPayee")).toHaveLength(registrations); // nothing sent mid-round
    expect((await v.payee(VAULT, contributorIdBytes32(people.bob!.id))).wallet).toBe(
      people.bob!.wallet,
    );
    v.approve(roundIdBytes32(round1));
    // FakeVault re-validates payees at execute like MisthosVault (PayeeMismatch); nothing changed, so it pays.
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "executed" });
    expect(v.balances.get(people.alice!.wallet.toLowerCase())).toBe(4n * U);
    expect(v.balances.get(people.bob!.wallet.toLowerCase())).toBe(4n * U);
    // After the round, Bob's new wallet is registered for the next one.
    expect((await v.payee(VAULT, contributorIdBytes32(people.bob!.id))).wallet).toBe(bobNew);
    expect(await actions()).toContain("payee.change_deferred");
  });

  it("F-02: one recipient the token refuses is dropped and carried over; everyone else is paid", async () => {
    const v = fake();
    await approved("alice", 2n * U);
    const bobSub = await approved("bob", 2n * U);
    v.blocked.add(people.bob!.wallet.toLowerCase()); // e.g. a USDC-blocklisted address
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "executed" });
    expect(v.balances.get(people.alice!.wallet.toLowerCase())).toBe(2n * U);
    expect(v.balances.get(people.bob!.wallet.toLowerCase()) ?? 0n).toBe(0n);
    // Bob's item is back in the queue for a later round, with the reason recorded.
    expect(
      (await db.select().from(submissions).where(eq(submissions.id, bobSub)))[0],
    ).toMatchObject({
      status: "approved",
      payoutId: null,
    });
    const replanned = (await db.select().from(auditEvents)).find(
      (a) => a.action === "round.replanned",
    );
    expect(replanned?.dataJson).toMatchObject({
      carriedOver: [{ contributorId: people.bob!.id, reason: "recipient_cannot_receive" }],
    });
    expect(v.calls).toContain("cancelRound");
  });

  it("F-06: splitting work into small rounds can't skip the owner: auto-pay is limited per 24 h, not per round", async () => {
    const v = fake(); // autoApproveThreshold 6 USDC
    await approved("alice", 4n * U);
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "executed" });
    // A second small round the same day: alone it's under the threshold, together they aren't.
    const next = (await db.select().from(rounds).where(eq(rounds.programId, programId))).find(
      (r) => r.number === 2,
    )!;
    await approved("bob", 4n * U, next.id);
    const sameDay = { ...deps(v), now: () => new Date("2026-10-12T06:00:00Z") };
    expect(await runRound(sameDay, next.id, { force: true })).toMatchObject({
      status: "awaiting_approval",
    });
    expect(v.balances.get(people.bob!.wallet.toLowerCase()) ?? 0n).toBe(0n);
    // Once the owner approves on-chain, it pays.
    const r2 = await roundRow(next.id);
    v.approve(r2.roundIdBytes32 as `0x${string}`);
    expect(await runRound(sameDay, next.id)).toMatchObject({ status: "executed" });
    expect(v.balances.get(people.bob!.wallet.toLowerCase())).toBe(4n * U);
  });
});
