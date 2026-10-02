/**
 * Live check: run real public resources through the full pipeline with real APIs, against a throwaway in-memory
 * database (nothing is written to Neon). Records raw API responses as fixtures (bodies only, never credentials).
 *
 *   pnpm --filter @misthos/agent live-check -- https://x.com/jack/status/20 https://github.com/o/r/pull/1
 *
 * Costs: one X post lookup (~$0.015) per X link and one Haiku call per judged item.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  apiUsage,
  contributors,
  decisions,
  fetchedResources,
  programMembers,
  programs,
  rounds,
  submissions,
  users,
} from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import {
  arcTestnet,
  classifySubmissionUrl,
  formatUsdc,
  hashText,
  Rubric,
  verifyDecisionRecord,
} from "@misthos/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createPublicClient, http, type Hex } from "viem";
import { fetchArticle } from "../src/fetch/article";
import { fetchGithubCommit, fetchGithubPr } from "../src/fetch/github";
import { fetchXPost } from "../src/fetch/x";
import { createJudge, type MessagesClient } from "../src/judge";
import { processSubmission, type Fetchers } from "../src/pipeline";
import { eoaSigner } from "../src/record";
import { simhash64, toSigned64 } from "../src/simhash";
import type { Resource } from "../src/types";

const RECORD_DIR = new URL("../test/fixtures/recorded/", import.meta.url);
mkdirSync(RECORD_DIR, { recursive: true });
const record = (name: string, body: unknown) =>
  writeFileSync(
    new URL(`${name}.json`, RECORD_DIR),
    JSON.stringify({ _note: `Recorded live on ${new Date().toISOString()}`, body }, null, 2) + "\n",
  );

/** fetch wrapper that saves each JSON response body under a name derived from the URL path. */
const recordingFetch = (prefix: string): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const res = await fetch(input, init);
    const clone = res.clone();
    const path = new URL(String(input)).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    clone.json().then(
      (b) => record(`${prefix}-${path}`, b),
      () => {},
    );
    return res;
  }) as typeof fetch;

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const RUBRIC = Rubric.parse({
  generalRules: "English only. Work must be about building on Arc or Circle's developer platform.",
  categories: [
    {
      key: "posts",
      name: "Posts and threads",
      description: "Original educational posts about Arc, USDC payments, or Circle developer tools",
      sourceTypes: ["x_post"],
      maxPoints: 10,
      criteria: [
        {
          key: "depth",
          name: "Depth",
          description: "Explains how or why something works, with specifics",
        },
        {
          key: "relevance",
          name: "Relevance",
          description: "Clearly about Arc, USDC, or Circle tooling",
        },
      ],
    },
    {
      key: "code",
      name: "Code contributions",
      description: "Merged pull requests or commits to public repos that build on Arc or Circle",
      sourceTypes: ["github_pr", "github_commit"],
      maxPoints: 20,
      requireMerged: true,
      criteria: [
        {
          key: "impact",
          name: "Impact",
          description: "Adds a meaningful capability or fixes a real problem",
        },
        { key: "quality", name: "Quality", description: "Readable, scoped, and documented" },
      ],
    },
  ],
});

async function main() {
  const urls = process.argv.slice(2).filter((a) => a !== "--");
  if (!urls.length) throw new Error("Pass one or more URLs.");
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.AGENT_MODEL_JUDGE || "claude-haiku-4-5-20251001";
  const signer = eoaSigner(env("AGENT_PRIVATE_KEY") as Hex);

  const fetchers: Fetchers = {
    x: (id) => fetchXPost(id, { bearerToken: env("X_BEARER_TOKEN"), fetch: recordingFetch("x") }),
    githubPr: (rid) =>
      fetchGithubPr(rid, { token: process.env.GITHUB_TOKEN, fetch: recordingFetch("github") }),
    githubCommit: (rid) =>
      fetchGithubCommit(rid, { token: process.env.GITHUB_TOKEN, fetch: recordingFetch("github") }),
    article: (rid) => fetchArticle(rid),
  };

  let judge = null;
  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    const recording: MessagesClient = {
      create: (async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        const msg = await client.messages.create(params);
        record(`anthropic-${msg.id}`, msg);
        return msg;
      }) as unknown as MessagesClient["create"],
    };
    judge = createJudge({ client: recording, model });
  } else {
    console.log(
      "ANTHROPIC_API_KEY is not set: items will be fetched and checked, but not judged.\n",
    );
  }

  const { db, client } = await testDb();
  const [owner] = await db
    .insert(users)
    .values({ walletAddress: signer.address.toLowerCase() })
    .returning();
  const [program] = await db
    .insert(programs)
    .values({
      slug: "live-check",
      name: "Live check",
      description: "Throwaway program for a live pipeline check",
      ownerUserId: owner!.id,
      chain: "arc-testnet",
      status: "active",
      rubricJson: RUBRIC,
      ratePerPoint: 1_000_000n,
      limitsJson: {
        maxPerPayout: "50000000",
        maxPerRound: "500000000",
        maxPerDay: "1000000000",
        autoApproveThreshold: "100000000",
        payeeCooldownSeconds: 0,
        maxAutoApproveItem: "20000000",
      },
      autoApproveConfidence: 0.8,
      minAccountAgeDays: 30,
      roundLengthDays: 30,
      firstRoundStartsAt: new Date(0),
    })
    .returning();
  await db
    .insert(programMembers)
    .values({ programId: program!.id, userId: owner!.id, role: "owner" });

  for (const url of urls) {
    const c = classifySubmissionUrl(url);
    if (!c.ok) throw new Error(`${url}: ${c.error}`);
    // Fetch once up front so the contributor can be the real author and the round can cover the real date;
    // seeding the cache means the pipeline makes no second call.
    const fetcher = {
      x_post: fetchers.x,
      github_pr: fetchers.githubPr,
      github_commit: fetchers.githubCommit,
      article: fetchers.article,
    }[c.sourceType];
    const { outcome, usage } = await fetcher(c.resourceId);
    if (outcome.status !== "ok") throw new Error(`${url}: ${outcome.detail}`);
    const r: Resource = outcome.resource;
    await db.insert(apiUsage).values(
      usage.map((u) => ({
        provider: u.provider,
        endpoint: u.endpoint,
        units: u.units,
        estCostUsd: u.estCostUsd.toFixed(6),
        programId: program!.id,
      })),
    );
    const sh = simhash64(r.text);
    await db.insert(fetchedResources).values({
      sourceType: c.sourceType,
      resourceId: c.resourceId,
      payloadJson: r,
      contentText: r.text,
      contentHash: hashText(r.text),
      simhash: sh === null ? null : toSigned64(sh),
    });

    const t = r.timestamp ? new Date(r.timestamp) : new Date();
    const [round] = await db
      .insert(rounds)
      .values({
        programId: program!.id,
        number: urls.indexOf(url) + 1,
        startsAt: new Date(t.getTime() - 86_400_000),
        endsAt: new Date(t.getTime() + 86_400_000),
      })
      .returning();
    const [u] = await db
      .insert(users)
      .values({
        xUserId: r.sourceType === "x_post" ? r.author.id! : `gh-${r.author.id}`,
        xHandle: r.author.handle ?? "author",
      })
      .returning();
    const [contributor] = await db
      .insert(contributors)
      .values({
        programId: program!.id,
        userId: u!.id,
        xUserId: u!.xUserId!,
        xHandle: u!.xHandle!,
        githubLogin: r.sourceType.startsWith("github") ? r.author.handle : null,
        walletAddress: `0x${String(urls.indexOf(url) + 1).padStart(40, "0")}`,
        walletVerifiedAt: new Date(),
      })
      .returning();
    const [sub] = await db
      .insert(submissions)
      .values({
        programId: program!.id,
        roundId: round!.id,
        contributorId: contributor!.id,
        url: c.canonicalUrl,
        sourceType: c.sourceType,
        resourceId: c.resourceId,
      })
      .returning();

    const started = Date.now();
    const res = await processSubmission(
      { db, fetchers, judge, signer, chainId: arcTestnet.id },
      sub!.id,
      { finalAttempt: true },
    );
    const [dec] = await db.select().from(decisions).where(eq(decisions.submissionId, sub!.id));
    const verified = await verifyDecisionRecord(
      createPublicClient({ chain: arcTestnet, transport: http() }),
      {
        decisionJson: dec!.decisionJson,
        decisionHash: dec!.decisionHash as Hex,
        signature: dec!.signature as Hex,
        signerAddress: dec!.signerAddress as Hex,
      },
    );
    console.log(`── ${url}`);
    console.log(
      `   author @${r.author.handle} · ${r.timestampKind} ${r.timestamp} · ${r.text.length} chars`,
    );
    console.log(
      `   action: ${res.status === "decided" ? res.action : res.status} · amount ${formatUsdc(dec!.amount)} · ${Date.now() - started} ms`,
    );
    console.log(
      `   flags: ${(dec!.flagsJson as { code: string; severity: string }[]).map((f) => `${f.code}(${f.severity})`).join(", ") || "none"}`,
    );
    if (dec!.llmOutputJson) {
      const o = dec!.llmOutputJson as {
        category: string;
        rubric_scores: Record<string, number>;
        confidence: number;
        recommended_action: string;
        reasons: string[];
      };
      console.log(
        `   judge: ${o.category} ${JSON.stringify(o.rubric_scores)} · confidence ${o.confidence} · recommends ${o.recommended_action}`,
      );
      for (const reason of o.reasons) console.log(`     - ${reason}`);
    }
    console.log(`   summary: ${dec!.summary}`);
    console.log(`   decisionHash ${dec!.decisionHash} · signature verifies: ${verified.ok}\n`);
  }

  const usage = await db.select().from(apiUsage);
  const total = usage.reduce((s, u) => s + Number(u.estCostUsd), 0);
  for (const u of usage)
    console.log(
      `usage: ${u.provider} ${u.endpoint} ×${u.units} $${Number(u.estCostUsd).toFixed(4)} ${JSON.stringify(u.metaJson)}`,
    );
  console.log(`estimated total API cost: $${total.toFixed(4)}`);
  await client.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
