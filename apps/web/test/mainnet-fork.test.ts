/**
 * Arc Mainnet, the whole loop, on a local Anvil fork of Arc Mainnet: no real funds, no Circle, nothing broadcast.
 *
 *   ARC_MAINNET_FORK=1 pnpm --filter @misthos/web exec vitest run test/mainnet-fork.test.ts
 *
 * What's real: mainnet's deployed MisthosVault template and MisthosVaultFactory (their bytecode and addresses, read
 * from the fork), the USDC address 0x3600…, the web server's chain code (factory/event checks, vault reads, Verify on
 * Arc Mainnet), the worker's network routing, Circle executor/signer code, queue drain, decision pipeline and round
 * job. What's not: Arc's native USDC precompile can't run in Anvil, so the code at 0x3600… is swapped for a 6-decimal
 * test token (ForkUsdcStub); the Circle LIVE client is CircleLiveClientStub (a local test key); the judge and the X
 * fetcher are stubs. Keys are generated per run; the fork is thrown away at the end.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The agent package by path: the web app doesn't depend on it (only this test drives the worker's code).
import {
  eoaSigner,
  type Judge,
  type Resource,
  type RoundDeps,
} from "../../../packages/agent/src/index";
import {
  contributors,
  decisions,
  payouts,
  programs,
  rounds,
  submissions,
  users,
  type DbLike,
} from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import {
  arcMainnet,
  getDeployment,
  misthosVaultAbi,
  misthosVaultFactoryAbi,
  programIdBytes32,
  ProgramInput,
  QUEUES,
} from "@misthos/shared";
import { eq } from "drizzle-orm";
import { fromPglite, PgBoss } from "pg-boss";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CircleLiveClientStub } from "../../worker/test/circle-live-client-stub";
import { createQueues, runDrain, type WorkerDeps } from "../../worker/src/jobs";
import { mainnetDeps } from "../../worker/src/start";
import { deriveMainnetLimits } from "@/lib/program-math";

const RUN = process.env.ARC_MAINNET_FORK === "1";
const FORK_URL = process.env.ARC_MAINNET_FORK_URL || "https://rpc.mainnet.arc.io";
const USDC = "0x3600000000000000000000000000000000000000" as const;
const here = path.dirname(fileURLToPath(import.meta.url));
const contracts = path.resolve(here, "../../../packages/contracts");
const quiet = () => undefined;
const log = { info: quiet, warn: quiet, error: quiet, debug: quiet } as unknown as Parameters<
  typeof runDrain
>[2];

const ownerKey = generatePrivateKey();
const agentKey = generatePrivateKey(); // the test agent key (stands in for the Circle mainnet SCA)
const payeeKey = generatePrivateKey();
const owner = privateKeyToAccount(ownerKey);
const agent = privateKeyToAccount(agentKey);
const payee = privateKeyToAccount(payeeKey).address;

let anvil: ChildProcess | undefined;
let rpc = "";
let fork: PublicClient;
let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let boss: PgBoss;

async function rpcCall(method: string, params: unknown[]) {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await r.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const resource: Resource = {
  sourceType: "x_post",
  resourceId: "5042",
  url: "https://x.com/alice/status/5042",
  timestamp: new Date().toISOString(),
  timestampKind: "posted",
  title: null,
  text: "How Arc quotes gas in USDC: a 6-decimal ERC-20 view over the 18-decimal native balance, with a worked example.",
  author: {
    id: "42",
    handle: "alice",
    name: null,
    createdAt: "2019-01-01T00:00:00Z",
    followers: 900,
  },
  x: {
    isRepost: false,
    isReply: false,
    isQuote: false,
    likes: 20,
    reposts: 2,
    replies: 1,
    quotes: 0,
    impressions: 1500,
    lang: "en",
  },
};
const judge: Judge = async () => ({
  output: {
    category: "posts",
    rubric_scores: { depth: 8 },
    total_points: 8,
    quality_summary: "Clear and specific.",
    reasons: ["Explains the decimals with an example."],
    soft_flags: [],
    confidence: 0.95,
    recommended_action: "approve",
  },
  model: "stub",
  promptVersion: "judge-v5",
  usage: { provider: "anthropic", endpoint: "POST /v1/messages", units: 1, estCostUsd: 0 },
});

describe.skipIf(!RUN)("Arc Mainnet fork: deploy, fund, decide, pay, verify (no real funds)", () => {
  beforeAll(async () => {
    const port = 18000 + Math.floor(Math.random() * 2000);
    rpc = `http://127.0.0.1:${port}`;
    anvil = spawn("anvil", ["--fork-url", FORK_URL, "--port", String(port), "--silent"], {
      stdio: "ignore",
    });
    for (let i = 0; i < 120; i++) {
      try {
        if (Number(await rpcCall("eth_chainId", [])) === 5042) break;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    fork = createPublicClient({
      chain: arcMainnet,
      transport: http(rpc),
      pollingInterval: 200,
    }) as PublicClient;
    expect(await fork.getChainId()).toBe(5042);

    // USDC: same address, test token code (see the header).
    const artifact = path.join(contracts, "out/ForkUsdcStub.sol/ForkUsdcStub.json");
    if (!existsSync(artifact))
      execFileSync("forge", ["build"], { cwd: contracts, stdio: "ignore" });
    const code = (
      JSON.parse(readFileSync(artifact, "utf8")) as { deployedBytecode: { object: Hex } }
    ).deployedBytecode.object;
    await rpcCall("anvil_setCode", [USDC, code]);
    for (const a of [owner.address, agent.address])
      await rpcCall("anvil_setBalance", [a, "0x56BC75E2D63100000"]); // 100 native USDC for gas
    await rpcCall("anvil_mine", ["0x1"]);
    const mint = createWalletClient({ account: owner, chain: arcMainnet, transport: http(rpc) });
    await fork.waitForTransactionReceipt({
      hash: await mint.writeContract({
        address: USDC,
        abi: [
          {
            type: "function",
            name: "mint",
            stateMutability: "nonpayable",
            inputs: [
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
            ],
            outputs: [],
          },
        ],
        functionName: "mint",
        args: [owner.address, 100_000_000n],
      }),
    });

    // The web server's view of Arc Mainnet: the fork, with the test agent as the mainnet agent.
    Object.assign(process.env, {
      NEXT_PUBLIC_APP_URL: "https://misthos.world",
      NEXT_PUBLIC_CHAIN: "arc-testnet",
      DATABASE_URL: "postgres://unused",
      SESSION_SECRET: "x".repeat(32),
      X_CLIENT_ID: "id",
      X_CLIENT_SECRET: "secret",
      ARC_MAINNET_RPC_URL: rpc,
      CIRCLE_AGENT_WALLET_ADDRESS: `0x${"a".repeat(40)}`,
      CIRCLE_MAINNET_AGENT_WALLET_ADDRESS: agent.address,
    });

    ctx = await testDb();
    db = ctx.db as unknown as DbLike;
    boss = new PgBoss({
      db: fromPglite(ctx.client),
      backend: "pglite",
      schema: "pgboss",
      supervise: false,
      schedule: false,
    });
    await boss.start();
  }, 120_000);

  afterAll(async () => {
    await boss?.stop({ graceful: false, timeout: 1000 });
    await ctx?.client.close();
    anvil?.kill("SIGTERM");
  });

  it("runs the whole loop on mainnet's real contracts and USDC address", async () => {
    const dep = getDeployment("arc-mainnet");
    // Mainnet's real factory and template, as deployed (read from the fork, not redeployed).
    expect(
      await fork.readContract({
        address: dep.vaultFactory!,
        abi: misthosVaultFactoryAbi,
        functionName: "implementation",
      }),
    ).toBe(dep.vaultImplementation);

    const vaultLib = await import("@/lib/server/vault");
    const { publicClient } = await import("@/lib/server/chain");
    const { verifyChain } = await import("@/lib/server/verify-chain");
    const { verifyDecision } = await import("@/lib/verify");
    const { createProgram, setProgramStatus } = await import("@/lib/server/programs");
    const { upsertWalletUser } = await import("@/lib/server/contributors");
    expect(vaultLib.availableChains()).toEqual(["arc-testnet", "arc-mainnet"]);
    expect(vaultLib.agentAddress("arc-mainnet")).toBe(agent.address);

    // ── 1. Owner creates a mainnet campaign with the wizard's safe limits ──
    const ownerUser = await upsertWalletUser(db, owner.address);
    const safe = deriveMainnetLimits(4_000_000n);
    const input = ProgramInput.parse({
      network: "arc-mainnet",
      context: {
        about: "Pays for clear explanations of how Arc and USDC gas work, with examples.",
      },
      basics: { name: "Fork", slug: "fork-main", description: "Mainnet fork loop.", logoUrl: "" },
      rubric: {
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
      },
      budget: {
        ratePerPoint: "0.5",
        roundLengthDays: 7,
        firstRoundStartsAt: new Date(Date.now() - 60_000).toISOString(),
        autoApproveConfidence: 0.8,
        maxAutoApproveItem: safe.maxAutoApproveItem,
        minAccountAgeDays: 0,
      },
      limits: { ...safe, payeeCooldownHours: "24" },
    });
    const created = await createProgram(db, {
      ownerUserId: ownerUser.id,
      chain: input.network,
      input,
    });
    if (!created.ok) throw new Error("create failed");
    const programId = created.programId;
    await setProgramStatus(db, { programId, userId: ownerUser.id, status: "active" });
    const [prog] = await db.select().from(programs).where(eq(programs.id, programId));
    expect(prog!.chain).toBe("arc-mainnet");
    expect(prog!.limitsJson.autoApproveThreshold).toBe("0");

    // ── 2. Owner deploys the vault from mainnet's factory (what the Deploy button sends) ──
    const ownerWallet = createWalletClient({
      account: owner,
      chain: arcMainnet,
      transport: http(rpc),
    });
    const l = prog!.limitsJson;
    const deployTx = await ownerWallet.writeContract({
      address: vaultLib.factoryAddress("arc-mainnet"),
      abi: misthosVaultFactoryAbi,
      functionName: "createVault",
      args: [
        programIdBytes32(programId),
        owner.address,
        vaultLib.agentAddress("arc-mainnet")!,
        "0x0000000000000000000000000000000000000000",
        {
          maxPerPayout: BigInt(l.maxPerPayout),
          maxPerRound: BigInt(l.maxPerRound),
          maxPerDay: BigInt(l.maxPerDay),
          autoApproveThreshold: BigInt(l.autoApproveThreshold),
          payeeCooldown: BigInt(l.payeeCooldownSeconds),
        },
      ],
    });
    await fork.waitForTransactionReceipt({ hash: deployTx });
    // The deploy route's checks, on Arc Mainnet.
    const ev = await vaultLib.findVaultCreated(deployTx, "arc-mainnet");
    expect(ev.programId).toBe(programIdBytes32(programId));
    expect(ev.agent).toBe(agent.address);
    // The same transaction is unknown on Arc Testnet (it was never there).
    await expect(vaultLib.findVaultCreated(deployTx, "arc-testnet")).rejects.toThrow();
    const vault = ev.vault as Address;
    const state = await vaultLib.readVault(vault, "arc-mainnet");
    expect(state.limits.autoApproveThreshold).toBe(0n);
    await db
      .update(programs)
      .set({ vaultAddress: vault.toLowerCase(), programIdBytes32: ev.programId })
      .where(eq(programs.id, programId));

    // ── 3. Owner funds it (approve + deposit, as the Fund button) ──
    await fork.waitForTransactionReceipt({
      hash: await ownerWallet.writeContract({
        address: vaultLib.usdcAddress("arc-mainnet"),
        abi: erc20Abi,
        functionName: "approve",
        args: [vault, 20_000_000n],
      }),
    });
    const depositTx = await ownerWallet.writeContract({
      address: vault,
      abi: misthosVaultAbi,
      functionName: "deposit",
      args: [20_000_000n],
    });
    await fork.waitForTransactionReceipt({ hash: depositTx });
    await vaultLib.findVaultEvent(depositTx, vault, "Deposited", "arc-mainnet");
    expect((await vaultLib.readVault(vault, "arc-mainnet")).balance).toBe(20_000_000n);

    // ── 4. A contributor with a verified payout wallet submits ──
    const [round] = await db.select().from(rounds).where(eq(rounds.programId, programId));
    const [u] = await db.insert(users).values({ xUserId: "42", xHandle: "alice" }).returning();
    const [c] = await db
      .insert(contributors)
      .values({
        programId,
        userId: u!.id,
        xUserId: "42",
        xHandle: "alice",
        walletAddress: payee,
        walletVerifiedAt: new Date(),
      })
      .returning();
    const [s] = await db
      .insert(submissions)
      .values({
        programId,
        roundId: round!.id,
        contributorId: c!.id,
        url: resource.url,
        sourceType: "x_post",
        resourceId: resource.resourceId,
      })
      .returning();

    // ── 5. The worker: testnet agent untouched, mainnet agent through the Circle LIVE client stub ──
    const testnetMustNotRun = () => {
      throw new Error("the testnet agent was used for a mainnet program");
    };
    const unused = async () => {
      throw new Error("unused");
    };
    const base: RoundDeps = {
      db,
      judge,
      signer: { ...eoaSigner(generatePrivateKey()), signHash: testnetMustNotRun },
      chainId: 5042002,
      fetchers: {
        x: async () => ({ outcome: { status: "ok", resource }, usage: [] }),
        githubPr: unused,
        githubCommit: unused,
        article: unused,
      },
      reader: new Proxy({}, { get: () => testnetMustNotRun }) as RoundDeps["reader"],
      executor: { kind: "eoa", address: `0x${"a".repeat(40)}`, send: testnetMustNotRun },
    };
    const stub = new CircleLiveClientStub({
      privateKey: agentKey,
      walletId: "mainnet-agent-wallet",
      rpcUrl: rpc,
      client: fork,
    });
    const mainnet = mainnetDeps(
      base,
      {
        apiKey: "LIVE_API_KEY:stub",
        entitySecret: "stub",
        walletId: "mainnet-agent-wallet",
        address: agent.address,
        rpcUrl: rpc,
      },
      () => stub.asCircleClient(),
    );
    const worker: WorkerDeps = {
      ...base,
      networks: ["arc-testnet", "arc-mainnet"],
      forChain: (k) => (k === "arc-mainnet" ? mainnet : k === "arc-testnet" ? base : null),
    };
    const opts = { concurrency: 1 };
    await createQueues(boss, opts);

    // Decision: signed by the mainnet agent, for Arc Mainnet.
    await boss.send(QUEUES.processSubmission, { submissionId: s!.id }, { singletonKey: s!.id });
    await runDrain(boss, worker, log, { ...opts, housekeeping: false });
    const [d] = await db.select().from(decisions).where(eq(decisions.submissionId, s!.id));
    expect(d).toMatchObject({ action: "approve", signerAddress: agent.address });
    const record = JSON.parse(d!.decisionJson) as { chainId: number };
    expect(record.chainId).toBe(5042);

    // Payee registered on the mainnet vault by the agent; the 24 h cooldown passes on the fork.
    await boss.send(QUEUES.syncPayee, { contributorId: c!.id });
    await runDrain(boss, worker, log, { ...opts, housekeeping: false });
    await rpcCall("evm_increaseTime", [24 * 3600 + 60]);
    await rpcCall("anvil_mine", ["0x1"]);

    // Round: closed and proposed; every round needs the owner (threshold 0).
    await boss.send(QUEUES.runRound, { roundId: round!.id, force: true });
    await runDrain(boss, worker, log, { ...opts, housekeeping: false });
    const [proposed] = await db.select().from(rounds).where(eq(rounds.id, round!.id));
    expect(proposed!.status).toBe("proposed");
    const roundIdBytes = proposed!.roundIdBytes32 as Hex;

    // Owner approves on Arc Mainnet (the Approve round button); the round approval route's check.
    const approveTx = await ownerWallet.writeContract({
      address: vault,
      abi: misthosVaultAbi,
      functionName: "approveRound",
      args: [roundIdBytes],
    });
    await fork.waitForTransactionReceipt({ hash: approveTx });
    await vaultLib.findVaultEvent(approveTx, vault, "RoundApproved", "arc-mainnet");

    // The worker's recovery picks the approved round up and executes it.
    await runDrain(boss, worker, log, opts);
    const [paid] = await db.select().from(rounds).where(eq(rounds.id, round!.id));
    expect(paid!.status).toBe("executed");
    const [po] = await db.select().from(payouts).where(eq(payouts.roundId, round!.id));
    expect(po!.status).toBe("executed");
    expect(po!.toAddress.toLowerCase()).toBe(payee.toLowerCase());
    expect(
      await fork.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [payee],
      }),
    ).toBe(po!.amount);
    expect((await vaultLib.readVault(vault, "arc-mainnet")).totalPaid).toBe(po!.amount);
    // Only the mainnet agent wallet was ever asked to sign or send.
    expect(new Set(stub.calls.map((x) => x.walletId))).toEqual(new Set(["mainnet-agent-wallet"]));
    expect(stub.calls.map((x) => x.label)).toEqual(
      expect.arrayContaining(["registerPayee", "proposeRound #1", "executeRound #1"]),
    );

    // ── 6. Verify, exactly as the public route wires it, on Arc Mainnet ──
    const client = publicClient("arc-mainnet");
    const verifyDeps = {
      db,
      client,
      getReceipt: (h: Hex) => client.getTransactionReceipt({ hash: h }).catch(() => null),
      explorerTx: (h: string) => vaultLib.explorerTx(h, "arc-mainnet"),
      chainKey: "arc-mainnet",
      chain: verifyChain(client, "arc-mainnet"),
    };
    const v = await verifyDecision(verifyDeps, d!.decisionJson);
    expect(v.steps.map((x) => `${x.id}:${x.state}`)).toEqual([
      "record:pass",
      "published:pass",
      "signature:pass",
      "payout:pass",
      "chain:pass",
    ]);
    expect(v.verified).toBe(true);
    expect(v.steps.find((x) => x.id === "signature")!.detail).toMatch(/read on Arc Mainnet/);
    expect(v.steps.find((x) => x.id === "chain")!.href).toMatch(
      /^https:\/\/explorer\.arc\.io\/tx\//,
    );

    // The same record checked against Arc Testnet is refused before any read.
    const t = await verifyDecision({ ...verifyDeps, chainKey: "arc-testnet" }, d!.decisionJson);
    expect(t.verified).toBe(false);
  }, 300_000);
});
