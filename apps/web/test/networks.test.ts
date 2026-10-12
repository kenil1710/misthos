import { programs, type DbLike } from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { ProgramInput, arcMainnet, arcTestnet } from "@misthos/shared";
import { eq } from "drizzle-orm";
import { createPublicClient, custom, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifySiwe } from "@/lib/server/siwe";

const saved = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  Object.assign(process.env, {
    NEXT_PUBLIC_APP_URL: "https://misthos.world",
    NEXT_PUBLIC_CHAIN: "arc-testnet",
    DATABASE_URL: "postgres://unused",
    SESSION_SECRET: "x".repeat(32),
    X_CLIENT_ID: "id",
    X_CLIENT_SECRET: "secret",
    CIRCLE_AGENT_WALLET_ADDRESS: `0x${"a".repeat(40)}`,
  });
  delete process.env.CIRCLE_MAINNET_AGENT_WALLET_ADDRESS;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("which networks a new campaign can use", () => {
  it("testnet always; mainnet only once its factory and its own agent are configured", async () => {
    const v = await import("@/lib/server/vault");
    expect(v.availableChains()).toEqual(["arc-testnet"]);
    // The testnet agent is never used for mainnet vaults.
    expect(v.agentAddress("arc-mainnet")).toBeNull();
    process.env.CIRCLE_MAINNET_AGENT_WALLET_ADDRESS = `0x${"b".repeat(40)}`;
    vi.resetModules();
    const v2 = await import("@/lib/server/vault");
    expect(v2.availableChains()).toEqual(["arc-testnet", "arc-mainnet"]);
    expect(v2.agentAddress("arc-mainnet")).toBe(`0x${"b".repeat(40)}`);
    expect(v2.agentAddress("arc-testnet")).toBe(`0x${"a".repeat(40)}`);
    // Mainnet vaults come from the mainnet factory.
    expect(v2.factoryAddress("arc-mainnet")).toBe("0x9075CbB50639216C2e4E32013514baa01f2b0C1b");
    expect(v2.factoryAddress("arc-testnet")).not.toBe(v2.factoryAddress("arc-mainnet"));
  });

  it("an unknown network is refused, never mapped to another", async () => {
    const { chainConfig } = await import("@/lib/server/chain");
    expect(() => chainConfig("ethereum")).toThrow('Unknown network "ethereum"');
    expect(chainConfig("arc-mainnet").chain.id).toBe(5042);
    expect(chainConfig().chain.id).toBe(5042002);
  });

  it("the wizard's input defaults to testnet and accepts only Arc networks", () => {
    const base = ProgramInput.shape.network;
    expect(base.parse(undefined)).toBe("arc-testnet");
    expect(base.parse("arc-mainnet")).toBe("arc-mainnet");
    expect(() => base.parse("base")).toThrow();
  });
});

describe("owner sign-in from either Arc network", () => {
  const offline = createPublicClient({
    chain: arcTestnet,
    transport: custom({
      request: async () => {
        throw new Error("offline");
      },
    }),
  });
  const now = new Date("2026-10-10T12:00:00Z");
  const run = async (chainId: number) => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = createSiweMessage({
      address: account.address,
      chainId,
      domain: "misthos.world",
      uri: "https://misthos.world",
      nonce: "abcdef0123456789",
      version: "1",
      issuedAt: now,
    });
    const used: number[] = [];
    const res = await verifySiwe({
      message,
      signature: await account.signMessage({ message }),
      expectedOrigin: "https://misthos.world",
      expectedChainId: [arcTestnet.id, arcMainnet.id],
      client: (id) => {
        used.push(id);
        return offline;
      },
      consumeNonce: async () => true,
      now,
    });
    return { res, used };
  };
  it("accepts Arc Testnet and Arc Mainnet, checking the signature on the network it names", async () => {
    expect(await run(5042)).toMatchObject({ res: { ok: true }, used: [5042] });
    expect(await run(5042002)).toMatchObject({ res: { ok: true }, used: [5042002] });
  });
  it("refuses any other chain", async () => {
    expect((await run(1)).res).toEqual({ ok: false, error: "wrong_chain" });
  });
});

describe("contributor wallet link on a mainnet campaign", () => {
  let ctx: Awaited<ReturnType<typeof testDb>>;
  let db: DbLike;
  beforeEach(async () => {
    ctx = await testDb();
    db = ctx.db as unknown as DbLike;
  });
  afterEach(async () => ctx.client.close());

  it("signs a message for Arc Mainnet and checks the signature on Arc Mainnet", async () => {
    const { createProgram, setProgramStatus } = await import("@/lib/server/programs");
    const { linkContributorWallet, upsertWalletUser, upsertXUser } =
      await import("@/lib/server/contributors");
    const owner = await upsertWalletUser(db, `0x${"c".repeat(40)}`);
    const input = ProgramInput.parse({
      network: "arc-mainnet",
      context: {
        about: "A mainnet campaign for builders on Arc: posts about USDC gas and payments.",
      },
      basics: { name: "Main", slug: "main-net", description: "Pays for Arc content.", logoUrl: "" },
      rubric: {
        categories: [
          {
            key: "threads",
            name: "Threads",
            description: "Original threads",
            sourceTypes: ["x_post"],
            maxPoints: 10,
            criteria: [{ key: "depth", name: "Depth", description: "Explains how it works" }],
          },
        ],
      },
      budget: {
        ratePerPoint: "1",
        roundLengthDays: 7,
        firstRoundStartsAt: new Date().toISOString(),
        autoApproveConfidence: 0.8,
        maxAutoApproveItem: "5",
        minAccountAgeDays: 0,
      },
      limits: {
        maxPerPayout: "10",
        maxPerRound: "50",
        maxPerDay: "100",
        autoApproveThreshold: "20",
        payeeCooldownHours: "24",
      },
    });
    const r = await createProgram(db, { ownerUserId: owner.id, chain: input.network, input });
    if (!r.ok) throw new Error("create failed");
    await setProgramStatus(db, { programId: r.programId, userId: owner.id, status: "active" });
    const [p] = await db.select().from(programs).where(eq(programs.id, r.programId));
    expect(p!.chain).toBe("arc-mainnet");

    const user = await upsertXUser(db, {
      id: "9",
      username: "maria",
      createdAt: new Date("2015-01-01"),
    });
    const seen: { message: string; chain: string }[] = [];
    const res = await linkContributorWallet(db, {
      programSlug: "main-net",
      user: { id: user.id, xUserId: "9", xHandle: "maria" },
      address: `0x${"d".repeat(40)}`,
      nonce: "n1",
      issuedAt: new Date(),
      signature: "0x01" as Hex,
      chainId: (chain) => (chain === "arc-mainnet" ? 5042 : 5042002),
      verify: async (args, chain) => {
        seen.push({ message: args.message, chain });
        return true;
      },
      consumeNonce: async () => true,
    });
    expect(res).toMatchObject({ ok: true, joined: true });
    expect(seen[0]!.chain).toBe("arc-mainnet");
    expect(seen[0]!.message).toContain("Chain ID: 5042\n");
  });
});
