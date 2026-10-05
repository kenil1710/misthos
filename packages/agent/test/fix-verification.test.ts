/**
 * Fix verification (docs/FIX_VERIFICATION.md): attacks against the F-01…F-11 fixes that the first repro tests didn't
 * cover. Each `V-xx` test started as a repro that passed while the weakness existed; they are now regressions that
 * assert the fixed behavior (N-1 … N-10). V-04 documents an accepted, conservative residual (N-11).
 */
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
import type { AgentExecutor } from "../src/chain/executor";
import { runChecks, type CheckContext } from "../src/checks";
import { decide } from "../src/engine";
import { parseArticle } from "../src/fetch/article";
import { fetchGithubCommit } from "../src/fetch/github";
import type { JudgmentOutput } from "../src/judge";
import type { Fetchers } from "../src/pipeline";
import { eoaSigner } from "../src/record";
import { runRound, type RoundDeps } from "../src/rounds/job";
import type { Resource } from "../src/types";
import { FakeVault } from "./fake-vault";
import { CATEGORIES, fixture, fixtureFetch } from "./helpers";

// ─── Money-flow harness (same shape as audit.test.ts) ────────────────────────

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

let tctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let programId: string;
let round1: string;
const people: Record<string, { id: string; xUserId: string; wallet: Address }> = {};

const xResource = (id: string, authorId: string): Resource => ({
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
const unused = async () => {
  throw new Error("unused");
};
const fetchers: Fetchers = {
  x: async (id) => ({
    outcome: { status: "ok", resource: xResource(id, id.split("-")[0]!) },
    usage: [],
  }),
  githubPr: unused,
  githubCommit: unused,
  article: unused,
};

beforeEach(async () => {
  tctx = await testDb();
  db = tctx.db as unknown as DbLike;
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
        maxPerRound: String(20n * U),
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
  await tctx.client.close();
});

let n = 0;
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
  await db.insert(decisions).values({
    submissionId: s!.id,
    flagsJson: [],
    action: "approve",
    amount,
    summary: "Approved.",
    decisionJson: JSON.stringify({ schema: "misthos.decision/v1", submission: { id: s!.id } }),
    decisionHash: keccak256(toBytes(`decision:${s!.id}`)),
    signature: "0x00",
    signerAddress: "0x0000000000000000000000000000000000000001",
    ruleVersion: "rules-v5",
    decidedBy: "agent",
  });
  return s!.id;
}

const deps = (
  vault: FakeVault,
  executor: AgentExecutor = vault,
  at = "2026-10-12T00:00:01Z",
): RoundDeps => ({
  db,
  fetchers,
  judge: null,
  signer: eoaSigner(generatePrivateKey()),
  chainId: 5042002,
  reader: vault,
  executor,
  now: () => new Date(at),
});
const fake = (o: Partial<FakeVault["lim"]> = {}, balance = 100n * U) =>
  new FakeVault(
    {
      maxPerPayout: 5n * U,
      maxPerRound: 20n * U,
      maxPerDay: 50n * U,
      autoApproveThreshold: 6n * U,
      payeeCooldown: 0n,
      ...o,
    },
    balance,
  );
const bal = (v: FakeVault, who: string) => v.balances.get(people[who]!.wallet.toLowerCase()) ?? 0n;
const sub = async (id: string) =>
  (await db.select().from(submissions).where(eq(submissions.id, id)))[0]!;
const roundRow = async (id = round1) =>
  (await db.select().from(rounds).where(eq(rounds.id, id)))[0]!;
const round2 = async () =>
  (await db.select().from(rounds).where(eq(rounds.programId, programId))).find(
    (r) => r.number === 2,
  )!;

/** A gate: `wait()` resolves once `open()` is called. */
const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { open, wait: () => p };
};

const expireLease = () =>
  db
    .update(rounds)
    .set({ lockUntil: new Date(Date.now() - 1000) })
    .where(eq(rounds.id, round1));

describe("FIX VERIFICATION: money flow (regressions)", () => {
  it("V-01 (N-1): a second run of a round that's being processed is skipped; the round pays each item once", async () => {
    const v = fake();
    const aliceSub = await approved("alice", 2n * U);
    await approved("bob", 2n * U);
    // Run B is about to send executeRound; Bob's address gets blocklisted at that moment.
    const bAtExecute = gate();
    const releaseB = gate();
    const execB: AgentExecutor = {
      kind: v.kind,
      address: v.address,
      send: async (call) => {
        if (call.label.startsWith("executeRound")) {
          bAtExecute.open();
          await releaseB.wait();
        }
        return v.send(call);
      },
    };
    const bDone = runRound(deps(v, execB), round1);
    await bAtExecute.wait();
    v.blocked.add(people.bob!.wallet.toLowerCase());
    // Run A (Railway deploy overlap, an ops script) can't take the round while B holds it.
    expect(await runRound(deps(v), round1)).toEqual({ status: "skipped", reason: "locked" });
    releaseB.open();
    // B's execute reverts; B cancels its own on-chain round and gives the items back.
    expect(await bDone).toMatchObject({ status: "failed" });
    expect(bal(v, "alice")).toBe(0n);
    expect(await sub(aliceSub)).toMatchObject({ status: "approved", payoutId: null });
    // The next round pays Alice exactly once.
    v.blocked.clear();
    const next = await round2();
    expect(await runRound(deps(v, v, "2026-10-19T00:00:02Z"), next.id)).toMatchObject({
      status: "executed",
    });
    expect(bal(v, "alice")).toBe(2n * U);
    expect(await sub(aliceSub)).toMatchObject({ status: "paid" });
  });

  it("V-01b (N-1): even if a run's lease expires mid-send and another run re-plans, the stale run touches only its own on-chain id", async () => {
    const v = fake();
    const aliceSub = await approved("alice", 2n * U);
    await approved("bob", 2n * U);
    const bAtExecute = gate();
    const releaseB = gate();
    const execB: AgentExecutor = {
      kind: v.kind,
      address: v.address,
      send: async (call) => {
        if (call.label.startsWith("executeRound")) {
          bAtExecute.open();
          await releaseB.wait();
        }
        return v.send(call);
      },
    };
    const bDone = runRound(deps(v, execB), round1).catch((e) => ({ threw: (e as Error).name }));
    await bAtExecute.wait();
    const r0 = (await roundRow()).roundIdBytes32;
    // B hangs past its lease (a stuck Circle call). Bob is blocklisted; run A takes over, drops Bob, cancels R0,
    // re-plans under a fresh id R1 and pays Alice.
    await expireLease();
    v.blocked.add(people.bob!.wallet.toLowerCase());
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "executed" });
    const r1 = (await roundRow()).roundIdBytes32;
    expect(r1).not.toBe(r0);
    expect(bal(v, "alice")).toBe(2n * U);
    // B wakes up: its execute of R0 reverts (cancelled). It must not release A's payouts or touch the round.
    releaseB.open();
    expect(await bDone).toMatchObject({ status: "skipped", reason: "superseded" });
    expect(await roundRow()).toMatchObject({ status: "executed", roundIdBytes32: r1 });
    expect(await sub(aliceSub)).toMatchObject({ status: "paid" });
    const live = (await db.select().from(payouts)).filter((p) => p.status !== "failed");
    expect(live.map((p) => [p.contributorId, p.status])).toEqual([[people.alice!.id, "executed"]]);
    // Nothing left to pay Alice again.
    v.blocked.clear();
    const next = await round2();
    expect(await runRound(deps(v, v, "2026-10-19T00:00:02Z"), next.id)).toMatchObject({
      status: "executed",
    });
    expect(bal(v, "alice")).toBe(2n * U);
  });

  it("V-02 (N-2): every re-plan gets a fresh on-chain id, across runs; content isn't fetched again", async () => {
    const v = fake();
    let fetches = 0;
    const counting = (at?: string): RoundDeps => ({
      ...deps(v, v, at),
      fetchers: {
        ...fetchers,
        x: async (id, o) => {
          fetches++;
          return fetchers.x(id, o);
        },
      },
    });
    await approved("alice", 4n * U);
    await approved("bob", 4n * U);
    await approved("carol", 4n * U);
    v.blocked.add(people.bob!.wallet.toLowerCase());
    // Run 1: Bob dropped, re-planned once (alice+carol = 8 > 6 threshold) → waits for the owner.
    expect(await runRound(counting(), round1)).toMatchObject({ status: "awaiting_approval" });
    const r1 = (await roundRow()).roundIdBytes32;
    // Carol is blocklisted too. The next pass cancels R1 and re-plans under a new id (never R1 again).
    v.blocked.add(people.carol!.wallet.toLowerCase());
    expect(await runRound(counting(), round1)).toMatchObject({ status: "executed" });
    const after = await roundRow();
    expect(after.roundIdBytes32).not.toBe(r1);
    // Run 2 re-plans twice: Carol is dropped, then Bob (back in the queue since run 1) is dropped again.
    expect(after.replanCount).toBe(3);
    expect(bal(v, "alice")).toBe(4n * U);
    // Each item was fetched once for its payout re-check, however many times the round was re-planned.
    expect(fetches).toBe(3);
  });

  it("V-03 (N-6): an under-funded vault waits for funds, keeps the owner's approval, and pays once funded", async () => {
    const v = fake();
    await approved("alice", 4n * U);
    await approved("bob", 4n * U);
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "awaiting_approval" });
    const rid = (await roundRow()).roundIdBytes32 as Hex;
    v.approve(rid); // owner approves on-chain
    v.vaultBalance = 1n * U; // …and the balance drops before the agent executes
    expect(await runRound(deps(v), round1)).toMatchObject({
      status: "awaiting_funds",
      total: 8n * U,
      balance: 1n * U,
    });
    expect((await roundRow()).lastError).toMatch(
      /^Vault needs funds: it holds 1\.00 USDC and this round pays 8\.00 USDC/,
    );
    expect(v.calls).not.toContain("cancelRound");
    expect((await v.round(VAULT, rid)).status).toBe(2); // still Approved on-chain
    expect((await db.select().from(auditEvents)).map((a) => a.action)).not.toContain(
      "round.replanned",
    );
    // Later passes keep waiting without repeating the notice; a deposit lets it pay.
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "awaiting_funds" });
    expect(
      (await db.select().from(auditEvents)).filter((a) => a.action === "round.awaiting_funds"),
    ).toHaveLength(1);
    v.vaultBalance = 100n * U;
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "executed" });
    expect(await roundRow()).toMatchObject({
      status: "executed",
      lastError: null,
      roundIdBytes32: rid,
    });
    expect(bal(v, "alice") + bal(v, "bob")).toBe(8n * U);
  });

  it("V-04 (N-11, documented residual): an owner approval made on the explorer counts toward the 24 h auto-pay total (errs safe)", async () => {
    const v = fake();
    await approved("alice", 4n * U);
    await approved("bob", 4n * U);
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "awaiting_approval" });
    v.approve((await roundRow()).roundIdBytes32 as Hex); // approved outside the app
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "executed" });
    expect((await roundRow()).txHashApprove).toBeNull();
    // A 1 USDC round the same day needs the owner, although nothing was auto-paid: conservative, not unsafe.
    const next = await round2();
    await approved("carol", 1n * U, next.id);
    const sameDay = deps(v, v, "2026-10-12T06:00:00Z");
    expect(await runRound(sameDay, next.id, { force: true })).toMatchObject({
      status: "awaiting_approval",
    });
  });
});

// ─── Agent ──────────────────────────────────────────────────────────────────

const post = (authorId: string, ts = "2026-10-06T14:00:00.000Z"): Resource => ({
  ...xResource("1", authorId),
  url: "https://x.com/alice/status/1",
  timestamp: ts,
  text: "A long original thread about how Arc settles gas in USDC and why 6-decimal accounting matters for builders shipping payment apps on it today.",
  author: {
    id: authorId,
    handle: "alice",
    name: null,
    createdAt: "2020-01-01T00:00:00Z",
    followers: 500,
  },
});
const cctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  sourceType: "x_post",
  resource: post("111"),
  contributor: {
    id: "alice-c",
    xUserId: "111",
    xHandle: "alice",
    githubLogin: null,
    githubUserId: null,
    walletChangedAt: null,
  },
  round: { startsAt: new Date("2026-10-05T00:00:00Z"), endsAt: new Date("2026-10-19T00:00:00Z") },
  program: { minAccountAgeDays: 0, payeeCooldownSeconds: 0, categories: CATEGORIES },
  sameResource: [],
  similar: [],
  submittedAt: new Date("2026-10-07T00:00:00Z"),
  ...over,
});
const judgment = (o: Partial<JudgmentOutput> = {}): JudgmentOutput => ({
  category: "threads",
  rubric_scores: { depth: 8, clarity: 8, originality: 8 },
  total_points: 8,
  quality_summary: "Good.",
  reasons: ["Specific."],
  soft_flags: [],
  confidence: 0.95,
  recommended_action: "approve",
  ...o,
});
const engine = (flags: ReturnType<typeof runChecks>, j: JudgmentOutput | null = judgment()) =>
  decide({
    flags,
    judgment: j,
    categories: CATEGORIES,
    resource: post("111"),
    ratePerPoint: 1_000_000n,
    autoApproveConfidence: 0.8,
    maxPerPayout: 50_000_000n,
    maxAutoApproveItem: 20_000_000n,
  });
const article = (html: string) => {
  const out = parseArticle("https://blog.example/arc-gas", "https://blog.example/arc-gas", html);
  if (out.status !== "ok") throw new Error("expected ok");
  return out.resource;
};
const BODY =
  "<p>" +
  "Arc is a stablecoin-native L1 and this article explains its gas model in depth. ".repeat(10) +
  "</p>";

const decideFor = (resource: Resource, flags: ReturnType<typeof runChecks>, j = judgment()) =>
  decide({
    flags,
    judgment: j,
    categories: CATEGORIES,
    resource,
    ratePerPoint: 1_000_000n,
    autoApproveConfidence: 0.8,
    maxPerPayout: 50_000_000n,
    maxAutoApproveItem: 20_000_000n,
  });

describe("FIX VERIFICATION: agent (regressions)", () => {
  it("V-05 (N-3): pre-submitting someone's article can't get its author rejected; who wrote it goes to a person", () => {
    const res = article(
      `<html><head><title>Arc gas</title><meta property="article:published_time" content="2026-10-06T00:00:00Z"><meta name="twitter:creator" content="@alice"></head><body><article><h1>Arc gas</h1>${BODY}</article></body></html>`,
    );
    expect(res.article?.authorHandles).toContain("alice");
    const flags = runChecks(
      cctx({
        sourceType: "article",
        resource: res,
        sameResource: [
          {
            submissionId: "mallory-sub",
            xHandle: "mallory",
            submittedAt: new Date("2026-10-06T15:00:00Z"),
          },
        ],
      }),
    );
    expect(flags.find((f) => f.code === "DUPLICATE_URL")).toMatchObject({ severity: "soft" });
    expect(decideFor(res, flags)).toMatchObject({ action: "escalate" });
    // And an article never auto-approves, even with nothing flagged.
    const good = judgment({ category: "articles", rubric_scores: { depth: 8, accuracy: 8 } });
    const clean = runChecks(cctx({ sourceType: "article", resource: res }));
    expect(decideFor(res, clean, good)).toMatchObject({
      action: "escalate",
      rule: "R9B_ARTICLE_REVIEW",
    });
  });

  it("V-06 (N-4): a back-dated article is never 'the original' against an X post; the conflict goes to a person", () => {
    const backdated = {
      submissionId: "mallory-article",
      contributorId: "mallory-c",
      xHandle: "mallory",
      url: "https://mallory.blog/arc-gas",
      submittedAt: new Date("2026-10-06T20:00:00Z"),
      similarity: 0.95,
      hamming: 2,
      contentAt: new Date("2026-10-05T09:00:00Z"), // the page claims it predates Alice's post
      sourceType: "article" as const,
    };
    const flags = runChecks(cctx({ similar: [backdated] }));
    expect(flags.find((f) => f.code === "NEAR_DUPLICATE")).toMatchObject({ severity: "soft" });
    expect(engine(flags)).toMatchObject({ action: "escalate" }); // Alice isn't rejected
    // Two X posts still order by X's own timestamps: the earlier one wins automatically.
    const xFirst = runChecks(cctx({ similar: [{ ...backdated, sourceType: "x_post" }] }));
    expect(xFirst.find((f) => f.code === "NEAR_DUPLICATE")).toMatchObject({ severity: "hard" });
  });

  it("V-07 (N-5): forum reply authors, bylines and display names never make someone an article's author", () => {
    const res = article(
      `<html><head><title>Arc gas deep dive</title><meta property="article:published_time" content="2026-10-06T00:00:00Z"></head><body>
       <div class="topic-body crawler-post"><span class="creator" itemprop="author"><a href="/u/realauthor"><span itemprop="name">Real Author</span></a></span>
       <div class="post" itemprop="text"><h1>Arc gas</h1>${BODY}</div></div>
       <div class="topic-body crawler-post"><span class="creator" itemprop="author"><a href="https://x.com/mallory"><span itemprop="name">Mallory (@mallory)</span></a></span>
       <div class="post" itemprop="text"><p>nice</p></div></div></body></html>`,
    );
    expect(res.article?.authorHandles ?? []).not.toContain("mallory");
    const flags = runChecks(
      cctx({
        sourceType: "article",
        resource: res,
        contributor: { ...cctx().contributor, xHandle: "mallory" },
      }),
    );
    expect(flags.find((f) => f.code === "OWNERSHIP_UNVERIFIED")).toMatchObject({
      severity: "soft",
    });
    expect(decideFor(res, flags)).toMatchObject({ action: "escalate" });
    // Structured metadata does count: <link rel="author"> to an X profile, or JSON-LD author links.
    const meta = article(
      `<html><head><title>Arc gas</title><link rel="author" href="https://x.com/RealAuthor"><script type="application/ld+json">{"@type":"BlogPosting","author":{"name":"Real","sameAs":["https://twitter.com/second_handle"]},"comment":[{"author":{"url":"https://x.com/mallory"}}]}</script></head><body><article>${BODY}</article></body></html>`,
    );
    expect(meta.article?.authorHandles?.sort()).toEqual(["realauthor", "second_handle"]);
  });

  it("V-08 (N-9): a GitHub secondary rate limit is retried later, never read as 'not merged'", async () => {
    const sha = "a".repeat(40);
    const call = fetchGithubCommit(`arc-builders/payroll@${sha}`, {
      token: "g",
      fetch: fixtureFetch({
        "/compare/": { json: { status: "behind" } },
        "/commits/": { json: fixture("github/commit.json") },
        "/repos/arc-builders/payroll": {
          status: 403,
          json: { message: "You have exceeded a secondary rate limit." },
          headers: { "x-ratelimit-remaining": "4990", "retry-after": "60" },
        },
      }),
    });
    await expect(call).rejects.toMatchObject({ name: "FetchError", retryable: true });
  });

  it("V-09 (N-10): paraphrased 'influence the grader' notes from the judge go to a person", () => {
    for (const note of [
      "asks reviewers to give full marks",
      "claims it was pre-approved by the program owner",
      "tries to game the rubric scoring",
      "contains text addressed to the AI reviewer",
    ])
      expect(engine([], judgment({ soft_flags: [note] }))).toMatchObject({ action: "escalate" });
    // Ordinary quality notes still allow auto-approval.
    for (const note of ["thin on detail", "mostly links", "low engagement"])
      expect(engine([], judgment({ soft_flags: [note] }))).toMatchObject({ action: "approve" });
  });
});
