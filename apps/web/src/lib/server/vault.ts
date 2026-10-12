import "server-only";
import { revalidateTag } from "next/cache";
import { cached } from "./cache";
import {
  CHAIN_KEYS,
  getDeployment,
  misthosVaultAbi,
  misthosVaultFactoryAbi,
  networkConfig,
  type ChainKey,
} from "@misthos/shared";
import { parseEventLogs, type Address, type Hex } from "viem";
import { chainConfig, publicClient } from "./chain";
import { env } from "./env";

export { programIdBytes32 } from "@misthos/shared";

/** The Misthos factory on a network (`chain`: the program's network; default the primary one). */
export function factoryAddress(chain?: string): Address {
  const f = getDeployment(chainConfig(chain).key).vaultFactory;
  if (!f) throw new Error("No vault factory deployed on this network");
  return f;
}

/**
 * The agent a network's vaults trust: its Circle SCA (env), never a key the web app holds. Arc Mainnet has its own
 * agent wallet (CIRCLE_MAINNET_AGENT_WALLET_ADDRESS) and never falls back to the testnet one.
 */
export function agentAddress(chain?: string): Address | null {
  return networkConfig(chainConfig(chain).key).agentWallet;
}

/**
 * Networks new programs can use: Arc Testnet always (as before: drafts don't need the agent yet); Arc Mainnet only
 * with its factory deployed and its own agent configured.
 */
export function availableChains(): ChainKey[] {
  return CHAIN_KEYS.filter(
    (k) => k === "arc-testnet" || (!!getDeployment(k).vaultFactory && !!agentAddress(k)),
  );
}

export class ChainVerifyError extends Error {}

async function receipt(txHash: Hex, chain?: string) {
  const r = await publicClient(chain)
    .getTransactionReceipt({ hash: txHash })
    .catch(() => null);
  if (!r) throw new ChainVerifyError("Transaction not found yet. Wait a moment and try again.");
  if (r.status !== "success") throw new ChainVerifyError("That transaction reverted.");
  return r;
}

/** Find a specific vault event in a confirmed transaction, emitted by that vault. */
export async function findVaultEvent<
  E extends "LimitsUpdated" | "RoundApproved" | "Deposited" | "Withdrawn" | "Paused" | "Unpaused",
>(txHash: Hex, vault: Address, eventName: E, chain?: string) {
  const r = await receipt(txHash, chain);
  const logs = parseEventLogs({ abi: misthosVaultAbi, logs: r.logs, eventName }).filter(
    (l) => l.address.toLowerCase() === vault.toLowerCase(),
  );
  if (!logs.length)
    throw new ChainVerifyError(`No ${eventName} event from this vault in that transaction.`);
  return { log: logs[0]!, blockNumber: r.blockNumber };
}

export async function findVaultCreated(txHash: Hex, chain?: string) {
  const r = await receipt(txHash, chain);
  const logs = parseEventLogs({
    abi: misthosVaultFactoryAbi,
    logs: r.logs,
    eventName: "VaultCreated",
  }).filter((l) => l.address.toLowerCase() === factoryAddress(chain).toLowerCase());
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

export async function readVault(vault: Address, chain?: string): Promise<VaultState> {
  const c = { address: vault, abi: misthosVaultAbi } as const;
  const results = await publicClient(chain).multicall({
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

export const explorerTx = (hash: string, chain?: string) =>
  `${chainConfig(chain).explorerUrl}/tx/${hash}`;
export const explorerAddress = (a: string, chain?: string) =>
  `${chainConfig(chain).explorerUrl}/address/${a}`;
export const usdcAddress = (chain?: string) => chainConfig(chain).tokens.usdc;
export { env };

const vaultTag = (vault: string) => `vault:${vault.toLowerCase()}`;

/**
 * Vault state for pages and lists: shared for up to 15 s, so a page doesn't wait on an Arc RPC round trip each view.
 * The owner's own transactions expire it at once (`vaultChanged`), so their change shows on the next render; payouts
 * sent by the agent show within 15 s.
 */
export function readVaultShared(vault: Address, chain?: string): Promise<VaultState> {
  const key = chainConfig(chain).key;
  return cached(() => readVault(vault, key), ["vault-state", key, vault.toLowerCase()], {
    revalidate: 15,
    tags: [vaultTag(vault)],
  })();
}

/** Call after recording an owner transaction on this vault (deposit, withdraw, pause, limits, approval). */
export function vaultChanged(vault: string) {
  revalidateTag(vaultTag(vault), { expire: 0 });
}
