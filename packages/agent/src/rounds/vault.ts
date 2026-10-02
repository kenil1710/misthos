import { misthosVaultAbi } from "@misthos/shared";
import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";

/** On-chain RoundStatus enum in MisthosVault. */
export const ChainRoundStatus = {
  None: 0,
  Proposed: 1,
  Approved: 2,
  Executed: 3,
  Cancelled: 4,
} as const;

export interface VaultLimits {
  maxPerPayout: bigint;
  maxPerRound: bigint;
  maxPerDay: bigint;
  autoApproveThreshold: bigint;
  payeeCooldown: bigint;
}

/** Everything the round job reads from the vault. A viem implementation for the chain, fakes for tests. */
export interface VaultReader {
  round(vault: Address, roundId: Hex): Promise<{ status: number; total: bigint }>;
  payee(
    vault: Address,
    contributorId: Hex,
  ): Promise<{ wallet: Address | null; payableAfter: bigint }>;
  limits(vault: Address): Promise<VaultLimits>;
  spentInWindow(vault: Address): Promise<bigint>;
  paid(vault: Address, payoutId: Hex): Promise<boolean>;
  /** Latest block timestamp (seconds); cooldowns compare against chain time, not server time. */
  chainTime(): Promise<bigint>;
}

const ZERO = "0x0000000000000000000000000000000000000000";

export function viemVaultReader(client: PublicClient): VaultReader {
  const read = <F extends Parameters<typeof client.readContract>[0]["functionName"]>(
    address: Address,
    functionName: F,
    args?: readonly unknown[],
  ) =>
    client.readContract({
      address,
      abi: misthosVaultAbi,
      functionName,
      args,
    } as never) as Promise<unknown>;
  return {
    async round(vault, roundId) {
      const r = (await read(vault, "getRound", [roundId])) as { status: number; total: bigint };
      return { status: Number(r.status), total: r.total };
    },
    async payee(vault, contributorId) {
      const p = (await read(vault, "payeeOf", [contributorId])) as {
        wallet: Address;
        payableAfter: bigint;
      };
      return { wallet: p.wallet === ZERO ? null : p.wallet, payableAfter: BigInt(p.payableAfter) };
    },
    async limits(vault) {
      const l = (await read(vault, "limits")) as VaultLimits;
      return { ...l, payeeCooldown: BigInt(l.payeeCooldown) };
    },
    spentInWindow: async (vault) => (await read(vault, "spentInWindow")) as bigint,
    paid: async (vault, payoutId) => (await read(vault, "paid", [payoutId])) as boolean,
    chainTime: async () => (await client.getBlock()).timestamp,
  };
}

export const vaultCalls = {
  registerPayee: (contributorId: Hex, wallet: Address) =>
    encodeFunctionData({
      abi: misthosVaultAbi,
      functionName: "registerPayee",
      args: [contributorId, wallet],
    }),
  proposeRound: (
    roundId: Hex,
    payouts: {
      payoutId: Hex;
      contributorId: Hex;
      to: Address;
      amount: bigint;
      decisionHash: Hex;
    }[],
    root: Hex,
  ) =>
    encodeFunctionData({
      abi: misthosVaultAbi,
      functionName: "proposeRound",
      args: [roundId, payouts, root],
    }),
  executeRound: (roundId: Hex) =>
    encodeFunctionData({ abi: misthosVaultAbi, functionName: "executeRound", args: [roundId] }),
};
