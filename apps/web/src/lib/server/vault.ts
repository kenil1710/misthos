import "server-only";
import { getDeployment, misthosVaultAbi, misthosVaultFactoryAbi } from "@misthos/shared";
import { parseEventLogs, type Address, type Hex } from "viem";
import { chainConfig, publicClient } from "./chain";
import { env } from "./env";

export { programIdBytes32, roundIdBytes32 } from "@misthos/shared";

export function factoryAddress(): Address {
  const f = getDeployment(chainConfig().key).vaultFactory;
  if (!f) throw new Error("No vault factory deployed on this network");
  return f;
}

/** The agent the vault trusts: the Circle SCA (env), never a key the web app holds. */
export function agentAddress(): Address | null {
  const a = process.env.CIRCLE_AGENT_WALLET_ADDRESS ?? process.env.AGENT_ADDRESS;
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as Address) : null;
}

export class ChainVerifyError extends Error {}

async function receipt(txHash: Hex) {
  const r = await publicClient()
    .getTransactionReceipt({ hash: txHash })
    .catch(() => null);
  if (!r) throw new ChainVerifyError("Transaction not found yet. Wait a moment and try again.");
  if (r.status !== "success") throw new ChainVerifyError("That transaction reverted.");
  return r;
}

/** Find a specific vault event in a confirmed transaction, emitted by that vault. */
export async function findVaultEvent<
  E extends "LimitsUpdated" | "RoundApproved" | "Deposited" | "Withdrawn" | "Paused" | "Unpaused",
>(txHash: Hex, vault: Address, eventName: E) {
  const r = await receipt(txHash);
  const logs = parseEventLogs({ abi: misthosVaultAbi, logs: r.logs, eventName }).filter(
    (l) => l.address.toLowerCase() === vault.toLowerCase(),
  );
  if (!logs.length)
    throw new ChainVerifyError(`No ${eventName} event from this vault in that transaction.`);
  return { log: logs[0]!, blockNumber: r.blockNumber };
}

export async function findVaultCreated(txHash: Hex) {
  const r = await receipt(txHash);
  const logs = parseEventLogs({
    abi: misthosVaultFactoryAbi,
    logs: r.logs,
    eventName: "VaultCreated",
  }).filter((l) => l.address.toLowerCase() === factoryAddress().toLowerCase());
  if (!logs.length)
    throw new ChainVerifyError("That transaction didn't create a vault from the Misthos factory.");
  return { ...logs[0]!.args, blockNumber: r.blockNumber };
}

export interface VaultState {
  balance: bigint;
  totalDeposited: bigint;
  totalPaid: bigint;
  totalWithdrawn: bigint;
  spentInWindow: bigint;
  paused: boolean;
  agent: Address;
  owner: Address;
  limits: {
    maxPerPayout: bigint;
    maxPerRound: bigint;
    maxPerDay: bigint;
    autoApproveThreshold: bigint;
    payeeCooldown: bigint;
  };
}

export async function readVault(vault: Address): Promise<VaultState> {
  const c = { address: vault, abi: misthosVaultAbi } as const;
  const results = await publicClient().multicall({
    contracts: [
      { ...c, functionName: "balance" },
      { ...c, functionName: "totalDeposited" },
      { ...c, functionName: "totalPaid" },
      { ...c, functionName: "totalWithdrawn" },
      { ...c, functionName: "spentInWindow" },
      { ...c, functionName: "paused" },
      { ...c, functionName: "agent" },
      { ...c, functionName: "owner" },
      { ...c, functionName: "limits" },
    ],
    allowFailure: false,
  });
  const [
    balance,
    totalDeposited,
    totalPaid,
    totalWithdrawn,
    spentInWindow,
    paused,
    agent,
    owner,
    limits,
  ] = results as unknown as [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    boolean,
    Address,
    Address,
    VaultState["limits"],
  ];
  return {
    balance,
    totalDeposited,
    totalPaid,
    totalWithdrawn,
    spentInWindow,
    paused,
    agent,
    owner,
    limits: { ...limits, payeeCooldown: BigInt(limits.payeeCooldown) },
  };
}

export const explorerTx = (hash: string) => `${chainConfig().explorerUrl}/tx/${hash}`;
export const explorerAddress = (a: string) => `${chainConfig().explorerUrl}/address/${a}`;
export const usdcAddress = () => chainConfig().tokens.usdc;
export { env };
