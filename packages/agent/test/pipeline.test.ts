import {
  apiUsage,
  auditEvents,
  contributors,
  decisions,
  fetchedResources,
  programMembers,
  programs,
  rounds,
  submissions,
  users,
  type DbLike,
} from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { classifySubmissionUrl, verifyDecisionRecord, arcTestnet } from "@misthos/shared";
import { asc, eq } from "drizzle-orm";
import { createPublicClient, custom, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArticle } from "../src/fetch/article";
import { fetchGithubPr } from "../src/fetch/github";
import { fetchXPost } from "../src/fetch/x";
import { createJudge } from "../src/judge";
import {
  processOverride,
  processSubmission,
  type Fetchers,
  type PipelineDeps,
} from "../src/pipeline";
import { eoaSigner } from "../src/record";
import { FetchError } from "../src/types";
import { fakeClaude, fixture, fixtureFetch, fixtureText, RUBRIC } from "./helpers";

const USDC = 1_000_000n;
const offline = createPublicClient({
  chain: arcTestnet,
  transport: custom({
    request: async () => {
      throw new Error("offline");
    },
  }),
});

/** X post id → fixture name */
const X_FIXTURES: Record<string, string> = {
  "1840000000000000001": "original-thread",
  "1840000000000000002": "copied-thread",
  "1840000000000000003": "someone-elses-post",
  "1840000000000000004": "out-of-window",
  "1840000000000000005": "deleted",
  "1840000000000000006": "injection",
  "1840000000000000008": "new-account-anomaly",
};

function fixtureFetchers() {
  const xFetch = vi.fn(async (id: string) => {
    const name = X_FIXTURES[id];
    if (!name) throw new Error(`no fixture for ${id}`);
    return fetchXPost(id, {
      bearerToken: "t",
      fetch: fixtureFetch({ "/2/tweets/": { json: fixture(`x/${name}.json`) } }),
    });
  });
  const fetchers: Fetchers = {
    x: xFetch,
    githubPr: (rid) =>
      fetchGithubPr(rid, {
        token: "g",
        fetch: fixtureFetch({
          "/pulls/42/files": { json: fixture("github/pr-files.json") },
          "/pulls/43/files": { json: fixture("github/pr-files.json") },
          "/pulls/42": { json: fixture("github/pr-merged.json") },
          "/pulls/43": { json: fixture("github/pr-unmerged.json") },
        }),
      }),
    githubCommit: async () => {
      throw new Error("unused");
    },
    article: async (rid) => ({
      outcome: parseArticle(
        rid,
        rid,
        fixtureText(rid.includes("hidden") ? "article/hidden-injection.html" : "article/good.html"),
      ),
      usage: [{ provider: "web", endpoint: "GET article", units: 1, estCostUsd: 0 }],
    }),
  };
  return { fetchers, xFetch };
}

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let programId: string;
let roundId: string;
let ownerId: string;
const people: Record<string, string> = {};

beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
  const [owner] = await db
    .insert(users)
    .values({ walletAddress: "0x00000000000000000000000000000000000000aa" })
    .returning();
  ownerId = owner!.id;
  const [p] = await db
    .insert(programs)
    .values({
      slug: "arc-builders",
      name: "Arc Builders",
      description: "Pays for Arc content",
      ownerUserId: ownerId,
      chain: "arc-testnet",
      status: "active",
      rubricJson: RUBRIC,
      ratePerPoint: 2n * USDC,
      limitsJson: {
        maxPerPayout: String(50n * USDC),
        maxPerRound: String(1000n * USDC),
        maxPerDay: String(2000n * USDC),
        autoApproveThreshold: String(250n * USDC),
        payeeCooldownSeconds: 86400,
        maxAutoApproveItem: String(20n * USDC),
      },
      autoApproveConfidence: 0.8,
      minAccountAgeDays: 30,
      roundLengthDays: 14,
      firstRoundStartsAt: new Date("2026-10-05T00:00:00Z"),
    })
    .returning();
  programId = p!.id;
  await db.insert(programMembers).values({ programId, userId: ownerId, role: "owner" });
  const [r] = await db
    .insert(rounds)
    .values({
      programId,
      number: 1,
      startsAt: new Date("2026-10-05T00:00:00Z"),
      endsAt: new Date("2026-10-19T00:00:00Z"),
    })
    .returning();
  roundId = r!.id;
  for (const [handle, xid, gh, wallet] of [
    ["alice_builds", "1000000001", "alice-dev", "b1"],
    ["bob_copies", "1000000002", "bob-dev", "b2"],
    ["fresh_acct", "1000000003", null, "b3"],
  ] as const) {
    const [u] = await db.insert(users).values({ xUserId: xid, xHandle: handle }).returning();
    const [c] = await db
      .insert(contributors)
      .values({
        programId,
        userId: u!.id,
        xUserId: xid,
        xHandle: handle,
        githubLogin: gh,
        walletAddress: `0x${wallet.padStart(40, "0")}`,
      })
      .returning();
    people[handle] = c!.id;
  }
});
afterEach(async () => {
  await ctx.client.close();
});

let clock = Date.parse("2026-10-07T00:00:00Z");
async function submit(handle: string, url: string) {
  const c = classifySubmissionUrl(url);
  if (!c.ok) throw new Error(c.error);
  clock += 60_000; // distinct, ordered submission times
  const [s] = await db
    .insert(submissions)
    .values({
      programId,
      roundId,
      contributorId: people[handle]!,
      url: c.canonicalUrl,
      sourceType: c.sourceType,
      resourceId: c.resourceId,
      createdAt: new Date(clock),
    })
    .returning();
  return s!.id;
}

function deps(
  claude = fakeClaude("approve-thread"),
  fetchers = fixtureFetchers().fetchers,
): PipelineDeps & { calls: unknown[] } {
  return {
    db,
    fetchers,
    judge: createJudge({ client: claude.client, model: "claude-haiku-4-5-20251001" }),
    signer: eoaSigner(generatePrivateKey()),
    chainId: 5042002,
    now: () => new Date("2026-10-08T00:00:00Z"),
    calls: claude.calls,
  };
}

const latestDecision = async (submissionId: string) =>
  (
    await db
      .select()
      .from(decisions)
      .where(eq(decisions.submissionId, submissionId))
      .orderBy(asc(decisions.createdAt))
  ).at(-1)!;
const statusOf = async (id: string) =>
  (await db.select().from(submissions).where(eq(submissions.id, id)))[0]!;
const flagCodes = (d: { flagsJson: unknown }) =>
  (d.flagsJson as { code: string }[]).map((f) => f.code);

describe("processSubmission", () => {
  it("approves original, owned, in-window work and stores a verifiable signed record", async () => {
    const d = deps();
    const id = await submit(
      "alice_builds",
      "https://x.com/alice_builds/status/1840000000000000001",
    );
    const res = await processSubmission(d, id);
    expect(res).toMatchObject({ status: "decided", action: "approve" });

    const sub = await statusOf(id);
    expect(sub).toMatchObject({ status: "approved", amount: 16n * USDC, lastError: null });
    const dec = await latestDecision(id);
    expect(dec).toMatchObject({
      action: "approve",
      amount: 16n * USDC,
      points: "8.00",
      categoryKey: "threads",
      decidedBy: "agent",
      model: "claude-haiku-4-5-20251001",
      promptVersion: "judge-v2",
      ruleVersion: "rules-v1",
    });
    expect(dec.summary).toMatch(
      /^Approved · 16\.00 USDC\. Posted inside the round by the linked account\. .* Scored 8\/10 on depth, 7\/10 on clarity and 9\/10 on originality\.$/,
    );

    const record = JSON.parse(dec.decisionJson);
    expect(record).toMatchObject({
      schema: "misthos.decision/v1",
      rule: "R10_AUTO_APPROVE",
      decidedBy: { type: "agent" },
      judgment: { promptVersion: "judge-v2" },
    });
    expect(record.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(
      await verifyDecisionRecord(offline, {
        decisionJson: dec.decisionJson,
        decisionHash: dec.decisionHash as Hex,
        signature: dec.signature as Hex,
        signerAddress: dec.signerAddress as Hex,
      }),
    ).toEqual({ ok: true });

    const audit = await db.select().from(auditEvents);
    expect(audit.map((a) => a.action)).toEqual(["decision.recorded"]);
    expect(audit[0]!.dataJson).toMatchObject({ decisionHash: dec.decisionHash, action: "approve" });

    const usage = await db.select().from(apiUsage);
    expect(usage.map((u) => [u.provider, u.estCostUsd])).toEqual([
      ["x", "0.015000"],
      ["anthropic", "0.003000"],
    ]);
  });

  it("rejects a copied thread from another contributor as NEAR_DUPLICATE without calling the model", async () => {
    const d = deps();
    await processSubmission(
      d,
      await submit("alice_builds", "https://x.com/alice_builds/status/1840000000000000001"),
    );
    const copy = await submit("bob_copies", "https://x.com/bob_copies/status/1840000000000000002");
    const before = d.calls.length;
    const res = await processSubmission(d, copy);
    expect(res).toMatchObject({ action: "reject" });
    expect(d.calls.length).toBe(before); // no LLM spend on a decided rejection
    const dec = await latestDecision(copy);
    expect(flagCodes(dec)).toContain("NEAR_DUPLICATE");
    const near = (
      dec.flagsJson as { code: string; evidence: Record<string, unknown>; severity: string }[]
    ).find((f) => f.code === "NEAR_DUPLICATE")!;
    expect(near.severity).toBe("hard");
    expect(near.evidence.matchedHandle).toBe("alice_builds");
    expect(Number(near.evidence.trigramSimilarity)).toBeGreaterThan(0.8);
    expect(dec.summary).toMatch(
      /^Rejected\. \d+% identical to a submission by @alice_builds on 2026-10-07\. Recycled content isn't paid/,
    );
  });

  it("rejects someone else's post (OWNERSHIP_MISMATCH)", async () => {
    const d = deps();
    const id = await submit("alice_builds", "https://x.com/bob_copies/status/1840000000000000003");
    await processSubmission(d, id);
    const dec = await latestDecision(id);
    expect(dec.action).toBe("reject");
    expect(flagCodes(dec)).toContain("OWNERSHIP_MISMATCH");
    expect(dec.summary).toBe(
      "Rejected. Posted by @bob_copies, not by the linked account @alice_builds. Only work by the linked account is paid.",
    );
    expect(d.calls).toHaveLength(0);
  });

  it("rejects an out-of-window post", async () => {
    const id = await submit(
      "alice_builds",
      "https://x.com/alice_builds/status/1840000000000000004",
    );
    await processSubmission(deps(), id);
    const dec = await latestDecision(id);
    expect([dec.action, flagCodes(dec)]).toEqual(["reject", ["OUT_OF_WINDOW"]]);
  });

  it("rejects a deleted post and never caches it", async () => {
    const id = await submit(
      "alice_builds",
      "https://x.com/alice_builds/status/1840000000000000005",
    );
    await processSubmission(deps(), id);
    expect(flagCodes(await latestDecision(id))).toEqual(["DELETED"]);
    expect(await db.select().from(fetchedResources)).toHaveLength(0);
  });

  it("escalates prompt injection even when the model is fooled into a perfect score", async () => {
    const d = deps(fakeClaude("injection-fooled"));
    const id = await submit(
      "alice_builds",
      "https://x.com/alice_builds/status/1840000000000000006",
    );
    await processSubmission(d, id);
    const dec = await latestDecision(id);
    expect(dec.action).toBe("escalate");
    expect((await statusOf(id)).status).toBe("escalated");
    expect(flagCodes(dec)).toContain("PROMPT_INJECTION_ATTEMPT");
    expect(JSON.parse(dec.decisionJson).rule).toBe("R2_INJECTION");
    expect(dec.summary).toMatch(/always get a human review/);
  });

  it("escalates a new account with anomalous engagement (soft flags)", async () => {
    const id = await submit("fresh_acct", "https://x.com/fresh_acct/status/1840000000000000008");
    await processSubmission(deps(), id);
    const dec = await latestDecision(id);
    expect(dec.action).toBe("escalate");
    expect(flagCodes(dec)).toEqual(expect.arrayContaining(["NEW_ACCOUNT", "ENGAGEMENT_ANOMALY"]));
  });

  it("rejects an unmerged PR (NOT_MERGED)", async () => {
    const open = await submit("alice_builds", "https://github.com/arc-builders/payroll/pull/43");
    await processSubmission(deps(fakeClaude("approve-pr")), open);
    expect(flagCodes(await latestDecision(open))).toEqual(["NOT_MERGED"]);
  });

  it("prices a merged PR and sends it to review when above the auto cap", async () => {
    const merged = await submit("alice_builds", "https://github.com/arc-builders/payroll/pull/42");
    await processSubmission(deps(fakeClaude("approve-pr")), merged);
    // pull_requests: max 20 points, (7+8)/20 → 15 points × 2 USDC = 30 USDC > 20 USDC auto cap
    const dec = await latestDecision(merged);
    expect(dec).toMatchObject({ action: "escalate", amount: 30n * USDC, points: "15.00" });
    expect(JSON.parse(dec.decisionJson).rule).toBe("R9_ABOVE_AUTO_CAP");
  });

  it("softly flags resubmitting your own near-identical work for review", async () => {
    const d = deps(fakeClaude("approve-pr"));
    await processSubmission(
      d,
      await submit("alice_builds", "https://github.com/arc-builders/payroll/pull/43"),
    );
    const merged = await submit("alice_builds", "https://github.com/arc-builders/payroll/pull/42");
    await processSubmission(d, merged);
    const dec = await latestDecision(merged);
    const near = (dec.flagsJson as { code: string; severity: string }[]).find(
      (f) => f.code === "NEAR_DUPLICATE",
    );
    expect(near?.severity).toBe("soft");
    expect(dec.action).toBe("escalate");
  });

  it("rejects a duplicate URL submitted by someone else, citing the first submitter", async () => {
    const d = deps();
    await processSubmission(
      d,
      await submit("alice_builds", "https://x.com/alice_builds/status/1840000000000000001"),
    );
    const dup = await submit(
      "bob_copies",
      "https://twitter.com/alice_builds/status/1840000000000000001?s=20",
    );
    await processSubmission(d, dup);
    const dec = await latestDecision(dup);
    expect(flagCodes(dec)).toEqual(expect.arrayContaining(["DUPLICATE_URL", "OWNERSHIP_MISMATCH"]));
    expect(dec.action).toBe("reject");
  });

  it("escalates articles with hidden injection text", async () => {
    const id = await submit("alice_builds", "https://blog.example.com/hidden-post");
    await processSubmission(deps(fakeClaude("approve-article")), id);
    const dec = await latestDecision(id);
    expect(dec.action).toBe("escalate");
    const inj = (dec.flagsJson as { code: string; evidence: Record<string, unknown> }[]).find(
      (f) => f.code === "PROMPT_INJECTION_ATTEMPT",
    )!;
    expect(inj.evidence.inHiddenText).toBe(true);
  });

  it("lets only one worker claim a submission", async () => {
    const id = await submit(
      "alice_builds",
      "https://x.com/alice_builds/status/1840000000000000001",
    );
    await db
      .update(submissions)
      .set({ status: "processing", updatedAt: new Date("2026-10-07T23:59:00Z") })
      .where(eq(submissions.id, id));
    expect(await processSubmission(deps(), id)).toEqual({
      status: "skipped",
      reason: "in_progress",
    });
    // A stale claim (crashed worker) can be taken over.
    await db
      .update(submissions)
      .set({ updatedAt: new Date("2026-10-01T00:00:00Z") })
      .where(eq(submissions.id, id));
    expect(await processSubmission(deps(), id)).toMatchObject({ status: "decided" });
  });

  it("is idempotent and fetches each resource once", async () => {
    const { fetchers, xFetch } = fixtureFetchers();
    const d = deps(fakeClaude("approve-thread"), fetchers);
    const id = await submit(
      "alice_builds",
      "https://x.com/alice_builds/status/1840000000000000001",
    );
    await processSubmission(d, id);
    expect(await processSubmission(d, id)).toEqual({
      status: "skipped",
      reason: "already_approved",
    });
    expect(await db.select().from(decisions)).toHaveLength(1);
    // A second submission of the same post (by someone else) reuses the cache.
    await processSubmission(
      d,
      await submit("bob_copies", "https://x.com/alice_builds/status/1840000000000000001"),
    );
    expect(xFetch).toHaveBeenCalledTimes(1);
    expect((await db.select().from(apiUsage)).filter((u) => u.provider === "x")).toHaveLength(1);
  });

  it("rethrows retryable fetch errors, then escalates on the final attempt", async () => {
    const { fetchers } = fixtureFetchers();
    fetchers.x = async () => {
      throw new FetchError("X API 503", true, 503);
    };
    const d = deps(fakeClaude("approve-thread"), fetchers);
    const id = await submit(
      "alice_builds",
      "https://x.com/alice_builds/status/1840000000000000001",
    );
    await expect(processSubmission(d, id)).rejects.toBeInstanceOf(FetchError);
    expect(await statusOf(id)).toMatchObject({ status: "pending", lastError: "X API 503" });
    await processSubmission(d, id, { finalAttempt: true });
    const dec = await latestDecision(id);
    expect(dec.action).toBe("escalate");
    expect(flagCodes(dec)).toEqual(["FETCH_FAILED"]);
    expect(dec.summary).toMatch(/couldn't complete its review/);
  });
});

describe("processOverride", () => {
  async function escalated() {
    const id = await submit(
      "alice_builds",
      "https://x.com/alice_builds/status/1840000000000000006",
    );
    await processSubmission(deps(fakeClaude("injection-resisted")), id);
    return id;
  }

  it("records a signed human decision that supersedes the agent's", async () => {
    const id = await escalated();
    const agentDec = await latestDecision(id);
    const d = deps();
    const r = await processOverride(d, {
      submissionId: id,
      userId: ownerId,
      action: "approve",
      amount: String(5n * USDC),
      reason: "Short but accurate tip; the injection line was a joke.",
    });
    expect(r.ok).toBe(true);
    const dec = await latestDecision(id);
    expect(dec).toMatchObject({
      decidedBy: "human",
      decidedByUserId: ownerId,
      action: "approve",
      amount: 5n * USDC,
      overrideReason: "Short but accurate tip; the injection line was a joke.",
    });
    expect(JSON.parse(dec.decisionJson).decidedBy).toEqual({
      type: "human",
      userId: ownerId,
      reason: "Short but accurate tip; the injection line was a joke.",
      supersedes: agentDec.decisionHash,
    });
    expect(dec.summary).toBe(
      "Approved by a reviewer · 5.00 USDC. Reason: Short but accurate tip; the injection line was a joke.",
    );
    expect(await statusOf(id)).toMatchObject({ status: "approved", amount: 5n * USDC });
    expect((await db.select().from(auditEvents)).map((a) => a.action)).toEqual([
      "decision.recorded",
      "decision.overridden",
    ]);
    expect(
      await verifyDecisionRecord(offline, {
        decisionJson: dec.decisionJson,
        decisionHash: dec.decisionHash as Hex,
        signature: dec.signature as Hex,
        signerAddress: dec.signerAddress as Hex,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses amounts above the vault's per-payout cap, and non-members", async () => {
    const id = await escalated();
    expect(
      await processOverride(deps(), {
        submissionId: id,
        userId: ownerId,
        action: "approve",
        amount: String(51n * USDC),
        reason: "Worth more than the cap.",
      }),
    ).toEqual({ ok: false, error: "invalid_amount" });
    expect(
      await processOverride(deps(), {
        submissionId: id,
        userId: people.bob_copies!,
        action: "reject",
        reason: "I am not a member here.",
      }),
    ).toEqual({ ok: false, error: "not_member" });
  });
});
