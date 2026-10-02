import { canonicalize, verifyDecisionRecord } from "@misthos/shared";
import { createPublicClient, custom, http, keccak256, toBytes, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { arcTestnet } from "@misthos/shared";
import { describe, expect, it } from "vitest";
import { eoaSigner, signRecord, type DecisionRecord } from "../src/record";
import fixture from "./fixtures/erc1271-decision.json" with { type: "json" };

const offline = createPublicClient({
  chain: arcTestnet,
  transport: custom({
    request: async () => {
      throw new Error("offline");
    },
  }),
});

const base = (): Omit<DecisionRecord, "signer"> => ({
  schema: "misthos.decision/v1",
  chainId: 5042002,
  program: { id: "p", slug: "arc" },
  submission: {
    id: "s",
    url: "https://x.com/a/status/1",
    sourceType: "x_post",
    resourceId: "1",
    submittedAt: "2026-10-06T00:00:00.000Z",
  },
  contributor: {
    id: "c",
    xUserId: "1",
    xHandle: "a",
    githubLogin: null,
    wallet: "0x00000000000000000000000000000000000000b1",
  },
  round: {
    id: "r",
    number: 1,
    startsAt: "2026-10-05T00:00:00.000Z",
    endsAt: "2026-10-19T00:00:00.000Z",
  },
  inputHash: `0x${"1".repeat(64)}`,
  contentHash: `0x${"2".repeat(64)}`,
  flags: [],
  judgment: null,
  ruleVersion: "rules-v2",
  rule: "R10_AUTO_APPROVE",
  decision: {
    action: "approve",
    categoryKey: "threads",
    points: "8.00",
    amount: "16000000",
    auto: true,
  },
  decidedBy: { type: "agent" },
  summary: "Approved · 16.00 USDC.",
  decidedAt: "2026-10-07T00:00:00.000Z",
});

describe("canonical JSON", () => {
  it("is independent of key order and serializes bigint/Date deterministically", () => {
    const a = canonicalize({
      b: 1,
      a: { d: 2n, c: new Date("2026-01-01T00:00:00Z") },
      u: undefined,
    });
    const b = canonicalize({ a: { c: new Date("2026-01-01T00:00:00Z"), d: 2n }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":"2026-01-01T00:00:00.000Z","d":"2"},"b":1}');
    expect(() => canonicalize({ x: Number.NaN })).toThrow();
  });
});

describe("signRecord", () => {
  it("produces the same hash for the same record, whatever the key order", async () => {
    const signer = eoaSigner(generatePrivateKey());
    const r1 = await signRecord(base(), signer);
    const shuffled = Object.fromEntries(Object.entries(base()).reverse()) as Omit<
      DecisionRecord,
      "signer"
    >;
    const r2 = await signRecord(shuffled, signer);
    expect(r1.decisionHash).toBe(r2.decisionHash);
    expect(r1.decisionHash).toBe(keccak256(toBytes(r1.decisionJson)));
    expect(JSON.parse(r1.decisionJson).signer).toBe(signer.address);
  });

  it("changes the hash when any decided field changes", async () => {
    const signer = eoaSigner(generatePrivateKey());
    const a = await signRecord(base(), signer);
    const b = await signRecord(
      { ...base(), decision: { ...base().decision, amount: "16000001" } },
      signer,
    );
    expect(a.decisionHash).not.toBe(b.decisionHash);
  });

  it("verifies (EOA) and detects tampering", async () => {
    const signer = eoaSigner(generatePrivateKey());
    const s = await signRecord(base(), signer);
    const rec = {
      decisionJson: s.decisionJson,
      decisionHash: s.decisionHash,
      signature: s.signature,
      signerAddress: signer.address,
    };
    expect(await verifyDecisionRecord(offline, rec)).toEqual({ ok: true });
    expect(
      await verifyDecisionRecord(offline, {
        ...rec,
        decisionJson: s.decisionJson.replace("16000000", "99000000"),
      }),
    ).toEqual({ ok: false, error: "hash_mismatch" });
    const other = eoaSigner(generatePrivateKey());
    expect(
      await verifyDecisionRecord(offline, {
        ...rec,
        signature: await other.signHash(s.decisionHash),
      }),
    ).toEqual({ ok: false, error: "bad_signature" });
  });
});

// A decision hash signed by the owner of MockERC1271Wallet on Arc testnet; verifies via isValidSignature.
describe.runIf(process.env.ARC_RPC_TESTS === "1")(
  "verifyDecisionRecord (live Arc, ERC-1271)",
  () => {
    const client = createPublicClient({ chain: arcTestnet, transport: http() });
    it("verifies a smart-contract-wallet signature over a decision hash", async () => {
      const rec = {
        decisionJson: fixture.decisionJson,
        decisionHash: fixture.decisionHash as Hex,
        signature: fixture.signature as Hex,
        signerAddress: fixture.erc1271Wallet as Hex,
      };
      expect(await verifyDecisionRecord(client, rec)).toEqual({ ok: true });
      expect(
        await verifyDecisionRecord(client, { ...rec, signerAddress: fixture.eoa as Hex }),
      ).toEqual({ ok: true });
      expect(
        await verifyDecisionRecord(client, {
          ...rec,
          decisionJson: rec.decisionJson.replace("approve", "reject"),
        }),
      ).toEqual({ ok: false, error: "hash_mismatch" });
    }, 20_000);
  },
);
