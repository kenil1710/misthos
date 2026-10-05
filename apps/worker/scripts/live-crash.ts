/**
 * Live crash test on Arc testnet (F-01): the worker is killed (SIGKILL) the instant executeRound returns, before it
 * records anything. A fresh worker process then picks the round up and must record it as paid without paying again.
 *
 * Real USDC on a throwaway vault deployed for this run (the deployer EOA plays the owner), the real Circle agent
 * wallet and the real round job. The database is a throwaway PGlite served over TCP from this (parent) process, so
 * it outlives the killed worker exactly like Neon would. Neon and every real program vault are untouched.
 *
 *   pnpm --filter @misthos/worker live:crash
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import {
  processSubmission,
  programIdBytes32,
  runRound,
  viemVaultReader,
  type AgentExecutor,
  type Fetchers,
  type Judge,
  type Resource,
  type RoundDeps,
} from "@misthos/agent";
import {
  auditEvents,
  contributors,
  createDb,
  payouts,
  programMembers,
  programs,
  rounds,
  submissions,
  users,
} from "@misthos/db";
import {
  arcTestnet,
  formatUsdc,
  getDeployment,
  misthosVaultAbi,
  misthosVaultFactoryAbi,
  Rubric,
} from "@misthos/shared";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
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
const U = 1_000_000n;
const USDC = "0x3600000000000000000000000000000000000000" as Address;
const PORT = Number(process.env.CRASH_DB_PORT ?? 54341);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`;
const SELF = fileURLToPath(import.meta.url);

const pub = createPublicClient({ chain: arcTestnet, transport: http() }) as PublicClient;

// Content and scores are scripted (this test is about money movement); decisions are still real signed records.
const resourceFor = (id: string): Resource => ({
  sourceType: "x_post",
  resourceId: id,
  url: `https://x.com/i/web/status/${id}`,
  timestamp: new Date(Date.now() - 1_000).toISOString(),
  timestampKind: "posted",
  title: null,
  text: `Post ${id}: how Arc settles contributor payouts in USDC, and why a crashed worker must never pay twice.`,
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
const judge: Judge = async () => ({
  output: {
    category: "posts",
    rubric_scores: { depth: 1 },
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
const unused = async () => {
  throw new Error("unused");
};
const fetchers: Fetchers = {
  x: async (id) => ({ outcome: { status: "ok", resource: resourceFor(id) }, usage: [] }),
  githubPr: unused,
  githubCommit: unused,
  article: unused,
};

/** Real worker dependencies against the TCP database; optionally die right after executeRound is sent. */
function workerDeps(killAfterExecute: boolean) {
  const { db, pool } = createDb(DB_URL, { max: 1 });
  const circle = circleClient(env("CIRCLE_API_KEY"), env("CIRCLE_ENTITY_SECRET"));
  const agent = env("CIRCLE_AGENT_WALLET_ADDRESS") as Address;
  const walletId = env("CIRCLE_AGENT_WALLET_ID");
  const real = circleExecutor(circle, walletId, agent);
  const executor: AgentExecutor = killAfterExecute
    ? {
        ...real,
        async send(tx) {
          const sent = await real.send(tx);
          if (tx.label.startsWith("executeRound")) {
            console.log(
              `  [worker ${process.pid}] executeRound landed: ${EXPLORER}/tx/${sent.txHash}`,
            );
            console.log(`  [worker ${process.pid}] SIGKILL before recording anything`);
            process.kill(process.pid, "SIGKILL");
          }
          return sent;
        },
      }
    : real;
  const deps: RoundDeps = {
    db,
    fetchers,
    judge,
    signer: circleSigner(circle, walletId, agent),
    chainId: arcTestnet.id,
    reader: viemVaultReader(pub),
    executor,
  };
  return { deps, pool };
}

/** Child process: one worker run of the round. */
async function child(mode: "crash" | "recover", roundId: string) {
  const { deps, pool } = workerDeps(mode === "crash");
  const res = await runRound(deps, roundId, { force: mode === "crash" });
  console.log(`  [worker ${process.pid}] round job returned: ${res.status}`);
  await pool.end();
}

function runChild(mode: "crash" | "recover", roundId: string) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    const p = spawn(process.execPath, [...process.execArgv, SELF, mode, roundId], {
      stdio: "inherit",
      env: process.env,
    });
    p.on("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function parent() {
  const owner = createWalletClient({
    chain: arcTestnet,
    transport: http(),
    account: privateKeyToAccount(env("DEPLOYER_PRIVATE_KEY") as Hex),
  });
  const agent = env("CIRCLE_AGENT_WALLET_ADDRESS") as Address;
  const factory = getDeployment("arc-testnet").vaultFactory!;
  const send = async (label: string, p: Promise<Hex>) => {
    const h = await p;
    const r = await pub.waitForTransactionReceipt({ hash: h });
    if (r.status !== "success") throw new Error(`${label} reverted`);
    console.log(`  ${label}: ${EXPLORER}/tx/${h}`);
    return r;
  };

  // The database outlives every worker process, like Neon.
  const pg = await PGlite.create({ extensions: { pg_trgm } });
  await migrate(drizzle(pg), {
    migrationsFolder: path.resolve(import.meta.dirname, "../../../packages/db/migrations"),
  });
  const server = new PGLiteSocketServer({
    db: pg,
    port: PORT,
    host: "127.0.0.1",
    maxConnections: 4,
  });
  await server.start();
  const { deps, pool } = workerDeps(false);
  const db = deps.db;

  console.log("\n1. Throwaway program, vault and contributors");
  const rubric = Rubric.parse({
    categories: [
      {
        key: "posts",
        name: "Posts",
        description: "Posts about building on Arc",
        sourceTypes: ["x_post"],
        maxPoints: 10,
        criteria: [{ key: "depth", name: "Depth", description: "Explains how and why" }],
      },
    ],
  });
  const [ownerUser] = await db
    .insert(users)
    .values({ walletAddress: owner.account.address.toLowerCase() })
    .returning();
  const startedAt = new Date(Date.now() - 3600_000);
  const limits = {
    maxPerPayout: 500_000n,
    maxPerRound: 1_000_000n,
    maxPerDay: 2_000_000n,
    autoApproveThreshold: 1_000_000n,
    payeeCooldown: 0n,
  };
  const [program] = await db
    .insert(programs)
    .values({
      slug: "live-crash",
      name: "Live crash check",
      description: "Throwaway program for the worker-killed-after-executeRound check",
      ownerUserId: ownerUser!.id,
      chain: "arc-testnet",
      status: "active",
      isDemo: true,
      rubricJson: rubric,
      ratePerPoint: U / 50n, // 0.02 USDC per point; score 1 → 0.02
      limitsJson: {
        maxPerPayout: "500000",
        maxPerRound: "1000000",
        maxPerDay: "2000000",
        autoApproveThreshold: "1000000",
        payeeCooldownSeconds: 0,
        maxAutoApproveItem: "500000",
      },
      autoApproveConfidence: 0.8,
      roundLengthDays: 7,
      firstRoundStartsAt: startedAt,
    })
    .returning();
  await db
    .insert(programMembers)
    .values({ programId: program!.id, userId: ownerUser!.id, role: "owner" });
  const [round] = await db
    .insert(rounds)
    .values({
      programId: program!.id,
      number: 1,
      startsAt: startedAt,
      endsAt: new Date(Date.now() + 7 * 86400_000),
    })
    .returning();
  // CRASH_VAULT reuses a funded throwaway vault from an earlier run of this script (never a real program's vault:
  // it must be owned by the deployer and hold no other program's money).
  const reuse = process.env.CRASH_VAULT as Address | undefined;
  let vault: Address;
  let fromBlock: bigint;
  if (reuse) {
    const [vOwner, vAgent, vProgram] = await Promise.all(
      (["owner", "agent", "programId"] as const).map((functionName) =>
        pub.readContract({ address: reuse, abi: misthosVaultAbi, functionName }),
      ),
    );
    if (
      String(vOwner).toLowerCase() !== owner.account.address.toLowerCase() ||
      String(vAgent).toLowerCase() !== agent.toLowerCase()
    )
      throw new Error(
        "CRASH_VAULT must be a throwaway vault owned by the deployer with the Circle agent",
      );
    vault = reuse;
    fromBlock = await pub.getBlockNumber();
    await db
      .update(programs)
      .set({ vaultAddress: vault.toLowerCase(), programIdBytes32: vProgram as Hex })
      .where(eq(programs.id, program!.id));
    console.log(`  reusing throwaway vault ${EXPLORER}/address/${vault}`);
  } else {
    const programBytes = programIdBytes32(program!.id);
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
    vault = parseEventLogs({
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
      "approve 0.10 USDC",
      owner.writeContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "approve",
        args: [vault, U / 10n],
      }),
    );
    await send(
      "deposit 0.10 USDC",
      owner.writeContract({
        address: vault,
        abi: misthosVaultAbi,
        functionName: "deposit",
        args: [U / 10n],
      }),
    );
    fromBlock = created.blockNumber;
  }

  const people: { name: string; wallet: Address }[] = [];
  for (const [name, xid] of [
    ["alice", "9100000001"],
    ["bob", "9100000002"],
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
    const [s] = await db
      .insert(submissions)
      .values({
        programId: program!.id,
        roundId: round!.id,
        contributorId: c!.id,
        url: `https://x.com/i/web/status/${xid}-1`,
        sourceType: "x_post",
        resourceId: `${xid}-1`,
      })
      .returning();
    const res = await processSubmission(deps, s!.id);
    console.log(
      `  ${name}: wallet ${wallet} · ${res.status === "decided" ? res.action : res.status}`,
    );
    people.push({ name, wallet });
  }

  const balances = async () =>
    Promise.all(
      people.map((p) =>
        pub.readContract({
          address: USDC,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [p.wallet],
        }),
      ),
    );
  const vaultBalance = () =>
    pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [vault] });

  console.log("\n2. Worker A runs the round and is killed right after executeRound");
  const a = await runChild("crash", round!.id);
  console.log(`  worker A exited: signal ${a.signal ?? "none"}, code ${a.code}`);
  const [afterCrash] = await db.select().from(rounds).where(eq(rounds.id, round!.id));
  const paidAfterCrash = await balances();
  console.log(
    `  database after the crash: round ${afterCrash!.status}, executed tx recorded: ${!!afterCrash!.txHashExecute}`,
  );
  console.log(
    `  on-chain after the crash: ${paidAfterCrash.map((b, i) => `${people[i]!.name} ${formatUsdc(b)}`).join(", ")}`,
  );

  console.log("\n3. Worker B (fresh process) picks the round up");
  const b = await runChild("recover", round!.id);
  console.log(`  worker B exited: code ${b.code}`);
  console.log("\n4. Worker C runs it once more (any later retry)");
  const c = await runChild("recover", round!.id);
  console.log(`  worker C exited: code ${c.code}`);

  const [final] = await db.select().from(rounds).where(eq(rounds.id, round!.id));
  const ps = await db.select().from(payouts).where(eq(payouts.roundId, round!.id));
  const subs = await db.select().from(submissions).where(eq(submissions.programId, program!.id));
  const audits = await db.select().from(auditEvents).where(eq(auditEvents.programId, program!.id));
  const executedLogs = await pub.getContractEvents({
    address: vault,
    abi: misthosVaultAbi,
    eventName: "RoundExecuted",
    fromBlock,
  });
  const payoutLogs = await pub.getContractEvents({
    address: vault,
    abi: misthosVaultAbi,
    eventName: "PayoutExecuted",
    fromBlock,
  });
  const finalBalances = await balances();
  const total = finalBalances.reduce((s, x) => s + x, 0n);
  const result = {
    roundStatus: final!.status,
    executeTxRecorded: final!.txHashExecute,
    payouts: ps.map((p) => p.status),
    submissions: subs.map((s) => s.status),
    onChainRoundExecutedEvents: executedLogs.length,
    onChainPayoutEvents: payoutLogs.length,
    contributorBalances: finalBalances.map((x, i) => `${people[i]!.name} ${formatUsdc(x)}`),
    totalPaid: formatUsdc(total),
    vaultLeft: formatUsdc(await vaultBalance()),
    recoveredFromChain: audits.some((x) =>
      JSON.stringify(x.dataJson).includes("recoveredFromChain"),
    ),
  };
  console.log("\n5. Result");
  console.log(JSON.stringify(result, null, 2));
  const ok =
    a.signal === "SIGKILL" &&
    final!.status === "executed" &&
    !!final!.txHashExecute &&
    executedLogs.length === 1 &&
    payoutLogs.length === people.length &&
    finalBalances.every((x) => x === U / 50n) &&
    subs.every((s) => s.status === "paid");
  console.log(ok ? "\nPASS: paid exactly once after the crash" : "\nFAIL");
  await pool.end();
  await server.stop();
  await pg.close();
  process.exit(ok ? 0 : 1);
}

const [mode, roundId] = process.argv.slice(2);
if (mode === "crash" || mode === "recover") await child(mode, roundId!);
else await parent();
