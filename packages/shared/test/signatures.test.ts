import { createPublicClient, custom, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { arcTestnet } from "../src/chains";
import { buildWalletLinkMessage } from "../src/identity";
import { verifyWalletSignature } from "../src/signatures";
import fixture from "./fixtures/arc-signatures.json" with { type: "json" };

/** A client whose RPC always fails: proves the EOA path works offline via viem's ecrecover fallback. */
const offline = createPublicClient({
  chain: arcTestnet,
  transport: custom({
    request: async () => {
      throw new Error("offline");
    },
  }),
});

const linkParams = {
  programSlug: "arc-builders",
  programName: "Arc Builders",
  xHandle: "alice",
  xUserId: "12345",
  address: "0x0000000000000000000000000000000000000001",
  chainId: 5042002,
  nonce: "n0nce",
  issuedAt: new Date("2026-10-02T12:00:00Z"),
};

describe("buildWalletLinkMessage", () => {
  it("binds program, X account, wallet, chain and nonce", () => {
    const m = buildWalletLinkMessage(linkParams);
    for (const part of [
      "arc-builders",
      "@alice (12345)",
      "0x0000000000000000000000000000000000000001",
      "5042002",
      "n0nce",
    ]) {
      expect(m).toContain(part);
    }
  });

  it("lowercases the wallet so checksum casing can't change the message", () => {
    const a = buildWalletLinkMessage({
      ...linkParams,
      address: "0xAbCdEf0000000000000000000000000000000001",
    });
    const b = buildWalletLinkMessage({
      ...linkParams,
      address: "0xabcdef0000000000000000000000000000000001",
    });
    expect(a).toBe(b);
  });
});

describe("verifyWalletSignature (offline, EOA)", () => {
  it("accepts the signer and rejects anyone else or a changed message", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = buildWalletLinkMessage({ ...linkParams, address: account.address });
    const signature = await account.signMessage({ message });

    expect(
      await verifyWalletSignature(offline, { address: account.address, message, signature }),
    ).toBe(true);
    const other = privateKeyToAccount(generatePrivateKey());
    expect(
      await verifyWalletSignature(offline, { address: other.address, message, signature }),
    ).toBe(false);
    expect(
      await verifyWalletSignature(offline, {
        address: account.address,
        message: `${message} `,
        signature,
      }),
    ).toBe(false);
  });

  it("returns false (not throw) for malformed signatures", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    expect(
      await verifyWalletSignature(offline, {
        address: account.address,
        message: "x",
        signature: "0x1234",
      }),
    ).toBe(false);
  });
});

// Live checks against Arc testnet: ARC_RPC_TESTS=1 pnpm --filter @misthos/shared test
describe.runIf(process.env.ARC_RPC_TESTS === "1")(
  "verifyWalletSignature (live Arc testnet)",
  () => {
    const client = createPublicClient({ chain: arcTestnet, transport: http() });
    const signature = fixture.signature as Hex;
    const eoa = fixture.eoa as Hex;
    const contract = fixture.erc1271Wallet as Hex;

    it("verifies an EOA signature", async () => {
      expect(
        await verifyWalletSignature(client, { address: eoa, message: fixture.message, signature }),
      ).toBe(true);
    });

    it("verifies the same signature through ERC-1271 for a contract wallet", async () => {
      expect(await client.getCode({ address: contract })).toMatch(/^0x.+/);
      expect(
        await verifyWalletSignature(client, {
          address: contract,
          message: fixture.message,
          signature,
        }),
      ).toBe(true);
    });

    it("rejects a contract wallet signature over a different message", async () => {
      expect(
        await verifyWalletSignature(client, {
          address: contract,
          message: `${fixture.message}!`,
          signature,
        }),
      ).toBe(false);
    });

    it("rejects a valid signature presented for an unrelated contract", async () => {
      // The vault implementation has code but no isValidSignature.
      const notAWallet = "0xbB016FeB193c9F1151e77444a2145c5dfAA965D7";
      expect(
        await verifyWalletSignature(client, {
          address: notAWallet,
          message: fixture.message,
          signature,
        }),
      ).toBe(false);
    }, 20_000);
  },
);
