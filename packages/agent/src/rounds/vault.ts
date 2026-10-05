import { misthosVaultAbi } from "@misthos/shared";
import {
  encodeFunctionData,
  erc20Abi,
  getAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

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
  /**
   * Would a transfer of `amount` from the vault to `to` succeed right now? (Simulated, nothing is sent.) Catches a
   * recipient the token refuses (e.g. a blocklisted address) before it can revert a whole round. Throws on RPC
   * trouble, returns false only for a real revert.
   */
  canReceive(vault: Address, to: Address, amount: bigint): Promise<boolean>;
  /** USDC the vault holds right now (what a round can pay out). */
  vaultFunds(vault: Address): Promise<bigint>;
  /** The transaction that executed a round, from its RoundExecuted event (null if not found in recent blocks). */
  executedTx(vault: Address, roundId: Hex): Promise<Hex | null>;
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
    vaultFunds: async (vault) => (await read(vault, "balance")) as bigint,
    paid: async (vault, payoutId) => (await read(vault, "paid", [payoutId])) as boolean,
    chainTime: async () => (await client.getBlock()).timestamp,
    async canReceive(vault, to, amount) {
      const token = (await read(vault, "token")) as Address;
      try {
        await client.call({
          account: vault,
          to: token,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
        });
        return true;
      } catch (e) {
        // A revert means the token refuses this transfer; anything else is an RPC problem the caller retries.
        if (/revert/i.test(`${(e as Error).message} ${(e as { details?: string }).details ?? ""}`))
          return false;
        throw e;
      }
    },
    async executedTx(vault, roundId) {
      // Arc's RPC caps log ranges (~10k blocks); a round is recorded within minutes of executing.
      const latest = await client.getBlockNumber();
      const logs = await client.getLogs({
        address: vault,
        event: roundExecutedEvent,
        args: { roundId },
        fromBlock: latest > 9_000n ? latest - 9_000n : 0n,
        toBlock: latest,
      });
      return (logs.at(-1)?.transactionHash as Hex | undefined) ?? null;
    },
  };
}

const roundExecutedEvent = getAbiItem({ abi: misthosVaultAbi, name: "RoundExecuted" });

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
  cancelRound: (roundId: Hex) =>
    encodeFunctionData({ abi: misthosVaultAbi, functionName: "cancelRound", args: [roundId] }),
};
