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
import { arcTestnet, canonicalize, hashOfHashes, misthosVaultAbi, Rubric } from "@misthos/shared";
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyDecision, type VerifyDeps } from "@/lib/verify";

const VAULT = "0x00000000000000000000000000000000000000f1" as Address;
const TO = "0x00000000000000000000000000000000000000b1" as Address;
const TX = `0x${"7".repeat(64)}` as Hex;
const agent = privateKeyToAccount(generatePrivateKey());
const offline = createPublicClient({
  chain: arcTestnet,
  transport: custom({
    request: async ({ method }: { method: string }) => {
      if (method === "eth_getCode") return "0x";
      throw new Error("offline");
    },
  }),
});

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let recordJson: string;
let rejectedJson: string;
let payoutIdBytes32: Hex;
let aggregate: Hex;

async function signed(record: object) {
  const json = canonicalize(record);
  const hash = keccak256(toBytes(json));
  return { json, hash, signature: await agent.signMessage({ message: { raw: hash } }) };
}

function receipt(
  o: { decisionHash?: Hex; amount?: bigint; vault?: Address } = {},
): TransactionReceipt {
  const topics = encodeEventTopics({
    abi: misthosVaultAbi,
    eventName: "PayoutExecuted",
    args: { roundId: `0x${"1".repeat(64)}`, payoutId: payoutIdBytes32, to: TO },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes32" }],
    [o.amount ?? 1_000_000n, o.decisionHash ?? aggregate],
  );
  return {
    blockNumber: 123n,
    logs: [
      {
        address: o.vault ?? VAULT,
        topics,
        data,
        blockNumber: 123n,
        logIndex: 0,
        transactionHash: TX,
        transactionIndex: 0,
        blockHash: TX,
        removed: false,
      },
    ],
  } as unknown as TransactionReceipt;
}
const deps = (r: TransactionReceipt | null | undefined = undefined): VerifyDeps => ({
  db,
  client: offline,
  getReceipt: async () => (r === undefined ? receipt() : r),
  explorerTx: (h) => `https://explorer/tx/${h}`,
  chain: {
    // The agent's history: `agentFrom` blocks onward it's `laterAgent` (a rotation), before that the test agent.
    agentAt: async (_vault, block) =>
      agentUnreadable ? null : block >= agentFrom ? laterAgent : agent.address,
    isFactoryVault: async (vault) => factoryVaults.has(vault.toLowerCase()),
    blockAt: async () => 100n,
  },
});
let agentUnreadable = false;
let agentFrom = 10_000n;
let laterAgent: Address = agent.address;
const factoryVaults = new Set([VAULT.toLowerCase()]);

beforeEach(async () => {
  agentUnreadable = false;
  agentFrom = 10_000n;
  laterAgent = agent.address;
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
  const [owner] = await db
    .insert(users)
    .values({ walletAddress: "0x00000000000000000000000000000000000000aa" })
    .returning();
  const [p] = await db
    .insert(programs)
    .values({
      slug: "v",
      name: "V",
      description: "Verify",
      ownerUserId: owner!.id,
      chain: "arc-testnet",
      status: "active",
      vaultAddress: VAULT,
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
      firstRoundStartsAt: new Date(),
    })
    .returning();
  const [r] = await db
    .insert(rounds)
    .values({ programId: p!.id, number: 1, startsAt: new Date(), endsAt: new Date() })
    .returning();
  const [u] = await db.insert(users).values({ xUserId: "1", xHandle: "alice" }).returning();
  const [c] = await db
    .insert(contributors)
    .values({ programId: p!.id, userId: u!.id, xUserId: "1", xHandle: "alice", walletAddress: TO })
    .returning();
  const mk = async (rid: string, action: "approve" | "reject", status: "paid" | "rejected") => {
    const [s] = await db
      .insert(submissions)
      .values({
        programId: p!.id,
        roundId: r!.id,
        contributorId: c!.id,
        url: `https://x.com/i/web/status/${rid}`,
        sourceType: "x_post",
        resourceId: rid,
        status,
        amount: action === "approve" ? 1_000_000n : 0n,
      })
      .returning();
    const rec = await signed({
      schema: "misthos.decision/v1",
      submission: { id: s!.id },
      decision: { action, amount: action === "approve" ? "1000000" : "0" },
      signer: agent.address,
    });
    await db.insert(decisions).values({
      submissionId: s!.id,
      flagsJson: [],
      action,
      amount: 0n,
      summary: "s",
      decisionJson: rec.json,
      decisionHash: rec.hash,
      signature: rec.signature,
      signerAddress: agent.address,
      ruleVersion: "rules-v2",
      decidedBy: "agent",
    });
    return { s: s!, rec };
  };
  const paid = await mk("10", "approve", "paid");
  const rejected = await mk("11", "reject", "rejected");
  recordJson = JSON.stringify(JSON.parse(paid.rec.json), null, 2); // what a person would paste: pretty-printed
  rejectedJson = rejected.rec.json;
  payoutIdBytes32 = keccak256(toBytes("payout"));
  aggregate = hashOfHashes([paid.rec.hash]);
  const [po] = await db
    .insert(payouts)
    .values({
      roundId: r!.id,
      contributorId: c!.id,
      payoutIdBytes32,
      toAddress: TO,
      amount: 1_000_000n,
      decisionHash: aggregate,
      status: "executed",
      txHash: TX,
    })
    .returning();
  await db
    .update(submissions)
    .set({ payoutId: po!.id })
    .where((await import("drizzle-orm")).eq(submissions.id, paid.s.id));
});
afterEach(async () => {
  await ctx.client.close();
});

const states = (v: Awaited<ReturnType<typeof verifyDecision>>) =>
  v.steps.map((s) => `${s.id}:${s.state}`);

describe("verifyDecision", () => {
  it("verifies a paid decision end to end, even when the pasted JSON is pretty-printed", async () => {
    const v = await verifyDecision(deps(), recordJson);
    expect(v.verified).toBe(true);
    expect(states(v)).toEqual([
      "record:pass",
      "published:pass",
      "signature:pass",
      "payout:pass",
      "chain:pass",
    ]);
    expect(v.steps.find((s) => s.id === "chain")!.href).toBe(`https://explorer/tx/${TX}`);
    expect(v.steps.find((s) => s.id === "signature")!.detail).toMatch(/ECDSA recovery/);
  });

  it("fails on any edit to the record", async () => {
    const v = await verifyDecision(deps(), recordJson.replace("1000000", "9000000"));
    expect(v.verified).toBe(false);
    expect(states(v)).toEqual([
      "record:pass",
      "published:fail",
      "signature:skip",
      "payout:skip",
      "chain:skip",
    ]);
  });

  it("verifies a rejected decision through its signature and says nothing was paid", async () => {
    const v = await verifyDecision(deps(), rejectedJson);
    expect(v.verified).toBe(true);
    expect(states(v)).toEqual([
      "record:pass",
      "published:pass",
      "signature:pass",
      "payout:skip",
      "chain:skip",
    ]);
    expect(v.steps.find((s) => s.id === "payout")!.detail).toMatch(/rejected/);
  });

  it.each([
    [
      "a different decision hash on-chain",
      () => receipt({ decisionHash: keccak256(toBytes("other")) }),
    ],
    ["a different amount on-chain", () => receipt({ amount: 2_000_000n })],
    ["no receipt", () => null],
  ])("fails the chain step for %s", async (_label, make) => {
    const v = await verifyDecision(deps(make()), recordJson);
    expect(v.verified).toBe(false);
    expect(v.steps.find((s) => s.id === "chain")!.state).toBe("fail");
  });

  it("fails when the stored signature doesn't belong to the signer", async () => {
    const forger = privateKeyToAccount(generatePrivateKey());
    const { eq } = await import("drizzle-orm");
    const [d] = await db
      .select()
      .from(decisions)
      .where(eq(decisions.decisionJson, canonicalize(JSON.parse(recordJson))));
    await db
      .update(decisions)
      .set({ signature: await forger.signMessage({ message: { raw: d!.decisionHash as Hex } }) })
      .where(eq(decisions.id, d!.id));
    expect(states(await verifyDecision(deps(), recordJson))).toEqual([
      "record:pass",
      "published:pass",
      "signature:fail",
      "payout:skip",
      "chain:skip",
    ]);
  });

  it("F-09: fails when the signer isn't the vault's agent on-chain, even if the signature itself is valid", async () => {
    agentFrom = 0n;
    laterAgent = "0x00000000000000000000000000000000000000e7";
    const v = await verifyDecision(deps(), recordJson);
    expect(v.verified).toBe(false);
    expect(v.steps.find((s) => s.id === "signature")).toMatchObject({
      state: "fail",
      detail: expect.stringContaining(
        "the vault's agent was 0x00000000000000000000000000000000000000e7",
      ),
    });
    agentFrom = 10_000n;
    agentUnreadable = true; // can't read the vault: never claims a verified signer
    expect((await verifyDecision(deps(), recordJson)).verified).toBe(false);
    agentUnreadable = false;
    expect((await verifyDecision(deps(), recordJson)).verified).toBe(true);
  });

  it("N-8: the vault comes from the on-chain payout event and must be a factory vault, not whatever the database says", async () => {
    // A payout event from a contract the factory didn't create proves nothing, even with a matching agent().
    const fake = "0x00000000000000000000000000000000000000f2" as Address;
    const v = await verifyDecision(deps(receipt({ vault: fake })), recordJson);
    expect(v.verified).toBe(false);
    expect(v.steps.find((s) => s.id === "signature")).toMatchObject({
      state: "fail",
      detail: expect.stringContaining("wasn't created by the Misthos vault factory"),
    });
    // Pointing the program at another vault in the database changes nothing for a paid record: the event decides.
    await db.update(programs).set({ vaultAddress: fake });
    const paid = await verifyDecision(deps(), recordJson);
    expect(paid.verified).toBe(true);
    expect(paid.steps.find((s) => s.id === "chain")!.detail).toContain(VAULT);
    // An unpaid record is pinned through the database's vault, so a swapped vault fails the factory check.
    const rejected = await verifyDecision(deps(null), rejectedJson);
    expect(rejected.verified).toBe(false);
    expect(rejected.steps.find((s) => s.id === "signature")!.detail).toContain(
      "wasn't created by the Misthos vault factory",
    );
  });

  it("N-8: older records keep verifying after the owner rotates the agent (read at the payout's block)", async () => {
    agentFrom = 500n; // a new agent from block 500; the payout was in block 123
    laterAgent = "0x00000000000000000000000000000000000000e7";
    const v = await verifyDecision(deps(), recordJson);
    expect(v.verified).toBe(true);
    expect(v.steps.find((s) => s.id === "signature")!.detail).toContain("at block 123");
    agentFrom = 10_000n;
    laterAgent = agent.address;
  });

  it("explains invalid input", async () => {
    const v = await verifyDecision(deps(), "not json");
    expect(v).toMatchObject({ verified: false, decisionHash: null });
    expect(v.steps[0]).toMatchObject({ id: "record", state: "fail" });
  });
});
