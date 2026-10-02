/**
 * Live end-to-end payout rounds on Arc testnet with real USDC, the real Circle agent wallet (executor + decision
 * signer, Gas Station sponsored) and the real round job. Uses a throwaway in-memory database (Neon untouched);
 * the deployer EOA plays the program owner's wallet.
 *
 *   pnpm --filter @misthos/worker live:round
 *
 * Round 1 auto-executes (under the approval threshold) and defers an item over maxPerPayout.
 * Round 2 exceeds the threshold, waits for the owner's approveRound, then executes.
 */
import {
  contributorIdBytes32,
  processSubmission,
  programIdBytes32,
  runRound,
  viemVaultReader,
  type Fetchers,
  type Judge,
  type Resource,
  type RoundDeps,
} from "@misthos/agent";
import {
  contributors,
  decisions,
  payouts,
  programMembers,
  programs,
  rounds,
  submissions,
  users,
} from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import {
  arcTestnet,
  formatUsdc,
  getDeployment,
  misthosVaultAbi,
  misthosVaultFactoryAbi,
  Rubric,
  verifyDecisionRecord,
} from "@misthos/shared";
import { writeFileSync } from "node:fs";
import { and, asc, eq } from "drizzle-orm";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { circleClient, circleExecutor, circleSigner } from "../src/circle";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const EXPLORER = "https://explorer.testnet.arc.io";
const tx = (h: string) => `${EXPLORER}/tx/${h}`;
const U = 1_000_000n;
const USDC = "0x3600000000000000000000000000000000000000" as Address;

async function main() {
  const pub = createPublicClient({ chain: arcTestnet, transport: http() }) as PublicClient;
  const owner = createWalletClient({
    chain: arcTestnet,
    transport: http(),
    account: privateKeyToAccount(env("DEPLOYER_PRIVATE_KEY") as Hex),
  });
  const circle = circleClient(env("CIRCLE_API_KEY"), env("CIRCLE_ENTITY_SECRET"));
  const agent = env("CIRCLE_AGENT_WALLET_ADDRESS") as Address;
  const walletId = env("CIRCLE_AGENT_WALLET_ID");
  const factory = getDeployment("arc-testnet").vaultFactory!;
  const send = async (label: string, p: Promise<Hex>) => {
    const h = await p;
    const r = await pub.waitForTransactionReceipt({ hash: h });
    if (r.status !== "success") throw new Error(`${label} reverted`);
    console.log(`  ${label}: ${tx(h)}`);
    return r;
  };

  // ── Program in a throwaway DB ─────────────────────────────────────────
  const { db, client } = await testDb();
  const rubric = Rubric.parse({
    categories: [
      {
        key: "posts",
        name: "Posts",
        description: "Posts about building on Arc",
        sourceTypes: ["x_post"],
        maxPoints: 20,
        criteria: [{ key: "depth", name: "Depth", description: "Explains how and why" }],
      },
    ],
  });
  const [ownerUser] = await db
    .insert(users)
    .values({ walletAddress: owner.account.address.toLowerCase() })
    .returning();
  const startedAt = new Date(Date.now() - 3600_000);
  const [program] = await db
    .insert(programs)
    .values({
      slug: "live-round",
      name: "Live round check",
      description: "Throwaway program for the live payout round check",
      ownerUserId: ownerUser!.id,
      chain: "arc-testnet",
      status: "active",
      isDemo: true,
      rubricJson: rubric,
      ratePerPoint: U / 10n, // 0.10 USDC per point
      limitsJson: {
        maxPerPayout: "1500000",
        maxPerRound: "3000000",
        maxPerDay: "10000000",
        autoApproveThreshold: "2000000",
        payeeCooldownSeconds: 0,
        maxAutoApproveItem: "2000000",
      },
      autoApproveConfidence: 0.8,
      roundLengthDays: 7,
      firstRoundStartsAt: startedAt,
    })
    .returning();
  await db
    .insert(programMembers)
    .values({ programId: program!.id, userId: ownerUser!.id, role: "owner" });
  const [round1] = await db
    .insert(rounds)
    .values({
      programId: program!.id,
      number: 1,
      startsAt: startedAt,
      endsAt: new Date(Date.now() + 7 * 86400_000),
    })
    .returning();

  // ── 1. Owner deploys the vault (agent = Circle SCA) and funds it ─────
  console.log("\n1. Owner deploys and funds the vault");
  const programBytes = programIdBytes32(program!.id);
  const limits = {
    maxPerPayout: 1_500_000n,
    maxPerRound: 3_000_000n,
    maxPerDay: 10_000_000n,
    autoApproveThreshold: 2_000_000n,
    payeeCooldown: 0n,
  };
  const created = await send(
    "createVault",
    owner.writeContract({
      address: factory,
      abi: misthosVaultFactoryAbi,
      functionName: "createVault",
      args: [
        programBytes,
        owner.account.address,
        agent,
        "0x0000000000000000000000000000000000000000",
        limits,
      ],
    }),
  );
  const vault = parseEventLogs({
    abi: misthosVaultFactoryAbi,
    logs: created.logs,
    eventName: "VaultCreated",
  })[0]!.args.vault;
  console.log(`  vault: ${EXPLORER}/address/${vault}`);
  await db
    .update(programs)
    .set({ vaultAddress: vault.toLowerCase(), programIdBytes32: programBytes })
    .where(eq(programs.id, program!.id));
  await send(
    "approve 5 USDC",
    owner.writeContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "approve",
      args: [vault, 5n * U],
    }),
  );
  await send(
    "deposit 5 USDC",
    owner.writeContract({
      address: vault,
      abi: misthosVaultAbi,
      functionName: "deposit",
      args: [5n * U],
    }),
  );

  // ── 2. Three contributors with fresh wallets; submissions scored and signed by the agent SCA ──
  console.log("\n2. Contributors submit; the agent scores and signs decisions (Circle SCA)");
  const people: Record<string, { id: string; xid: string; wallet: Address }> = {};
  for (const [name, xid] of [
    ["alice", "9000000001"],
    ["bob", "9000000002"],
    ["carol", "9000000003"],
  ] as const) {
    const wallet = privateKeyToAccount(generatePrivateKey()).address;
    const [u] = await db.insert(users).values({ xUserId: xid, xHandle: name }).returning();
    const [c] = await db
      .insert(contributors)
      .values({
        programId: program!.id,
        userId: u!.id,
        xUserId: xid,
        xHandle: name,
        walletAddress: wallet.toLowerCase(),
        walletVerifiedAt: new Date(),
      })
      .returning();
    people[name] = { id: c!.id, xid, wallet };
    console.log(`  ${name}: wallet ${wallet}`);
  }
  const resourceFor = (id: string): Resource => ({
    sourceType: "x_post",
    resourceId: id,
    url: `https://x.com/i/web/status/${id}`,
    // Posted "just now": inside whichever round is open when it is fetched.
    timestamp: new Date(Date.now() - 1_000).toISOString(),
    timestampKind: "posted",
    title: null,
    text: `Post ${id}: how Arc settles payroll in USDC with deterministic finality and 6-decimal accounting.`,
    author: {
      id: id.split("-")[0]!,
      handle: "live",
      name: null,
      createdAt: "2020-01-01T00:00:00Z",
      followers: 500,
    },
    x: {
      isRepost: false,
      isReply: false,
      isQuote: false,
      likes: 5,
      reposts: 1,
      replies: 0,
      quotes: 0,
      impressions: 400,
      lang: "en",
    },
  });
  // Content and scores are scripted (this check is about money movement); every decision is still a real signed record.
  const scores: Record<string, number> = {};
  const judge: Judge = async (input) => ({
    output: {
      category: "posts",
      rubric_scores: { depth: scores[input.resource.resourceId]! },
      total_points: 0,
      quality_summary: "Clear, specific explanation for builders.",
      reasons: ["Specific."],
      soft_flags: [],
      confidence: 0.9,
      recommended_action: "approve",
    },
    model: "scripted-live-check",
    promptVersion: "judge-v2",
    usage: { provider: "anthropic", endpoint: "none", units: 0, estCostUsd: 0 },
  });
  const fetchers: Fetchers = {
    x: async (id) => ({ outcome: { status: "ok", resource: resourceFor(id) }, usage: [] }),
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
  const deps: RoundDeps = {
    db,
    fetchers,
    judge,
    signer: circleSigner(circle, walletId, agent),
    chainId: arcTestnet.id,
    reader: viemVaultReader(pub),
    executor: circleExecutor(circle, walletId, agent),
  };
  const submit = async (who: string, n: number, score: number, roundId: string) => {
    const rid = `${people[who]!.xid}-${n}`;
    scores[rid] = score;
    const [s] = await db
      .insert(submissions)
      .values({
        programId: program!.id,
        roundId,
        contributorId: people[who]!.id,
        url: `https://x.com/i/web/status/${rid}`,
        sourceType: "x_post",
        resourceId: rid,
      })
      .returning();
    const res = await processSubmission(deps, s!.id);
    const [d] = await db.select().from(decisions).where(eq(decisions.submissionId, s!.id));
    const ok = await verifyDecisionRecord(pub, {
      decisionJson: d!.decisionJson,
      decisionHash: d!.decisionHash as Hex,
      signature: d!.signature as Hex,
      signerAddress: d!.signerAddress as Hex,
    });
    console.log(
      `  ${who} #${n}: ${res.status === "decided" ? res.action : res.status} ${formatUsdc(d!.amount)} · decision ${d!.decisionHash.slice(0, 12)}… signed by SCA, verifies: ${ok.ok}`,
    );
  };
  await submit("alice", 1, 5, round1!.id); // 1.00
  await submit("alice", 2, 4, round1!.id); // 0.80 → alice would total 1.80 > 1.50 cap
  await submit("bob", 1, 3, round1!.id); // 0.60

  // ── 3. Round 1: close → payees → plan → propose → auto-execute ────────
  console.log("\n3. Round 1 (total ≤ 2.00 threshold → executes automatically)");
  const r1 = await runRound(deps, round1!.id, { force: true });
  console.log(`  outcome: ${r1.status}${"total" in r1 ? ` · ${formatUsdc(r1.total)}` : ""}`);
  const show = async (roundId: string) => {
    const [r] = await db.select().from(rounds).where(eq(rounds.id, roundId));
    if (r!.txHashPropose) console.log(`  proposeRound: ${tx(r!.txHashPropose)}`);
    if (r!.txHashApprove) console.log(`  approveRound (owner): ${tx(r!.txHashApprove)}`);
    if (r!.txHashExecute) console.log(`  executeRound: ${tx(r!.txHashExecute)}`);
    for (const p of await db
      .select({ p: payouts, h: contributors.xHandle })
      .from(payouts)
      .innerJoin(contributors, eq(contributors.id, payouts.contributorId))
      .where(eq(payouts.roundId, roundId))
      .orderBy(asc(payouts.createdAt))) {
      console.log(
        `    @${p.h} ${formatUsdc(p.p.amount)} → ${p.p.toAddress} · decisionHash ${p.p.decisionHash.slice(0, 12)}… · ${p.p.status}`,
      );
    }
    return r!;
  };
  await show(round1!.id);
  for (const c of await db
    .select()
    .from(contributors)
    .where(eq(contributors.programId, program!.id))) {
    if (c.payeeTxHash) console.log(`  registerPayee @${c.xHandle}: ${tx(c.payeeTxHash)}`);
  }

  // ── 4. Round 2: carol + alice's deferred item, above threshold → owner approval ──
  const [round2] = await db
    .select()
    .from(rounds)
    .where(and(eq(rounds.programId, program!.id), eq(rounds.number, 2)));
  await submit("carol", 1, 7, round2!.id); // 1.40
  console.log(
    "\n4. Round 2 (alice's deferred 0.80 + carol 1.40 = 2.20 > 2.00 → needs owner approval)",
  );
  const r2 = await runRound(deps, round2!.id, { force: true });
  console.log(`  outcome: ${r2.status}${"total" in r2 ? ` · ${formatUsdc(r2.total)}` : ""}`);
  if (r2.status !== "awaiting_approval")
    throw new Error(`expected round 2 to await approval, got ${r2.status}`);
  const [proposed] = await db.select().from(rounds).where(eq(rounds.id, round2!.id));
  // The owner signs in their wallet (here: the deployer key), then the app records it and the agent executes.
  const approval = await send(
    "owner approveRound",
    owner.writeContract({
      address: vault,
      abi: misthosVaultAbi,
      functionName: "approveRound",
      args: [proposed!.roundIdBytes32 as Hex],
    }),
  );
  await db
    .update(rounds)
    .set({ status: "approved", txHashApprove: approval.transactionHash })
    .where(eq(rounds.id, round2!.id));
  const r2b = await runRound(deps, round2!.id);
  console.log(
    `  after approval: ${r2b.status}${"total" in r2b ? ` · ${formatUsdc(r2b.total)}` : ""}`,
  );
  await show(round2!.id);

  // ── 5. Balances ───────────────────────────────────────────────────────
  console.log("\n5. Balances on-chain");
  for (const [name, p] of Object.entries(people)) {
    const b = await pub.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [p.wallet],
    });
    console.log(`  ${name} ${p.wallet}: ${formatUsdc(b)}  ${EXPLORER}/address/${p.wallet}`);
  }
  const vb = await pub.readContract({
    address: vault,
    abi: misthosVaultAbi,
    functionName: "balance",
  });
  const paid = await pub.readContract({
    address: vault,
    abi: misthosVaultAbi,
    functionName: "totalPaid",
  });
  console.log(`  vault balance ${formatUsdc(vb)} · totalPaid ${formatUsdc(paid)}`);

  writeFileSync(
    new URL("./.live-round.json", import.meta.url),
    JSON.stringify(
      { vault, demoContributorBytes32: contributorIdBytes32(people.alice!.id) },
      null,
      2,
    ),
  );
  await client.close();
}

main().catch((e) => {
  console.error("live round failed:", (e as Error).message);
  process.exit(1);
});
