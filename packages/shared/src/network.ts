import {
  CHAIN_KEYS,
  getChainConfig,
  isChainKey,
  type ArcChainConfig,
  type ChainKey,
} from "./chains";
import { getDeployment } from "./deployments";

/**
 * The network a visitor is looking at (header switch). Stored in this cookie (and mirrored in localStorage) as the
 * chain key; anything else, or nothing, means Arc Testnet.
 */
export const NETWORK_COOKIE = "misthos_network";
export const DEFAULT_NETWORK: ChainKey = "arc-testnet";

/** A stored network choice, or the default for anything missing or unknown. */
export function parseNetwork(value: unknown): ChainKey {
  return isChainKey(value) ? value : DEFAULT_NETWORK;
}

/** Short names for badges and the switch. */
export const NETWORK_SHORT: Record<ChainKey, string> = {
  "arc-testnet": "Testnet",
  "arc-mainnet": "Mainnet",
};

const isAddress = (a: string | undefined): a is `0x${string}` =>
  !!a && /^0x[0-9a-fA-F]{40}$/.test(a);

/** Environment variables that name each network's RPC and agent wallet (names only; values come from the env). */
export const NETWORK_ENV: Record<ChainKey, { rpc: string; agentAddress: readonly string[] }> = {
  // The testnet agent may also be the EOA fallback (AGENT_ADDRESS), as before.
  "arc-testnet": {
    rpc: "ARC_RPC_URL",
    agentAddress: ["CIRCLE_AGENT_WALLET_ADDRESS", "AGENT_ADDRESS"],
  },
  // Arc Mainnet has its own agent and never falls back to the testnet one.
  "arc-mainnet": {
    rpc: "ARC_MAINNET_RPC_URL",
    agentAddress: ["CIRCLE_MAINNET_AGENT_WALLET_ADDRESS"],
  },
};

export interface NetworkConfig {
  key: ChainKey;
  chainId: number;
  name: string;
  isTestnet: boolean;
  /** The RPC override from the env, else the chain's public RPC. */
  rpcUrl: string;
  explorerUrl: string;
  faucetUrl: string | null;
  usdc: `0x${string}`;
  vaultFactory: `0x${string}` | null;
  vaultImplementation: `0x${string}` | null;
  circleBlockchain: ArcChainConfig["circleBlockchain"];
  /** The agent wallet this network's vaults trust, or null when it isn't configured. */
  agentWallet: `0x${string}` | null;
  chain: ArcChainConfig["chain"];
}

/**
 * Everything about one network a program can be on: chain id, RPC, explorer, USDC, factory, Circle blockchain and
 * agent wallet. Pass the program's `chain`. An unknown key throws: a program is never moved to another network.
 */
export function networkConfig(
  chain: string,
  env: Record<string, string | undefined> = process.env,
): NetworkConfig {
  if (!isChainKey(chain)) throw new Error(`Unknown network "${chain}"`);
  const cfg = getChainConfig(chain);
  const dep = getDeployment(chain);
  const names = NETWORK_ENV[chain];
  const agent = names.agentAddress.map((n) => env[n]).find((v) => v);
  return {
    key: chain,
    chainId: cfg.chain.id,
    name: cfg.chain.name,
    isTestnet: cfg.isTestnet,
    rpcUrl: env[names.rpc] || cfg.chain.rpcUrls.default.http[0]!,
    explorerUrl: cfg.explorerUrl,
    faucetUrl: cfg.faucetUrl,
    usdc: cfg.tokens.usdc,
    vaultFactory: dep.vaultFactory,
    vaultImplementation: dep.vaultImplementation,
    circleBlockchain: cfg.circleBlockchain,
    agentWallet: isAddress(agent) ? agent : null,
    chain: cfg.chain,
  };
}

/** Every network, testnet first. */
export const allNetworks = (env?: Record<string, string | undefined>) =>
  CHAIN_KEYS.map((k) => networkConfig(k, env));
