import { defineChain, type Chain } from "viem";

/**
 * Arc network configuration. Every value is sourced from the Arc/Circle docs
 * (verified 2026-09-26) and cross-checked against live RPCs where possible.
 *
 * Doc sources:
 *  [ARC-CONNECT]   https://docs.arc.io/arc/references/connect-to-arc
 *  [ARC-ADDR]      https://docs.arc.io/arc/references/contract-addresses
 *  [ARC-EVMDIFF]   https://docs.arc.io/arc/references/evm-differences
 *  [CIRCLE-WALLET] https://developers.circle.com/wallets/supported-blockchains
 *  [CIRCLE-PM]     https://developers.circle.com/paymaster/addresses-and-events
 *  [AGENT-WALLET]  https://developers.circle.com/agent-stack/agent-wallets/supported-blockchains
 *
 * Live verification (2026-09-26):
 *  eth_chainId @ https://rpc.testnet.arc.io  -> 0x4cef52 (5042002)
 *  eth_chainId @ https://rpc.mainnet.arc.io  -> 0x13b2   (5042)
 *  USDC(0x3600…).decimals() on testnet       -> 6
 */

export type ChainKey = "arc-testnet" | "arc-mainnet";

/**
 * USDC on Arc has two interfaces over ONE balance [ARC-EVMDIFF]:
 *  - native gas token: 18 decimals (msg.value, eth_getBalance, gas fees)
 *  - ERC-20 interface at 0x3600…0000: 6 decimals (balanceOf/transfer)
 *
 * Misthos does ALL payout accounting through the ERC-20 interface (6 decimals).
 * Native (18-dec) values are only ever used for gas estimation/display, and must
 * be divided by 1e12 to become USDC. Never mix the two in the same arithmetic.
 */
export const USDC_ERC20_DECIMALS = 6 as const;
export const USDC_NATIVE_DECIMALS = 18 as const;
export const NATIVE_TO_ERC20_SCALE = 10n ** 12n;

export const EURC_DECIMALS = 6 as const; // [ARC-ADDR]

export interface ArcChainConfig {
  key: ChainKey;
  chain: Chain;
  /** Circle Wallets / Contracts blockchain identifier, or null if Circle doesn't support this network. */
  circleBlockchain: "ARC-TESTNET" | null;
  explorerUrl: string;
  faucetUrl: string | null;
  cctpDomain: number;
  isTestnet: boolean;
  tokens: {
    /** ERC-20 interface to native USDC, 6 decimals. [ARC-ADDR] */
    usdc: `0x${string}`;
    /** 6 decimals. [ARC-ADDR] */
    eurc: `0x${string}`;
    /** Permissioned: requires Circle/Hashnote allowlisting ($100k min for non-US institutions). [ARC-ADDR] */
    usyc: `0x${string}`;
    usycTeller: `0x${string}`;
    usycEntitlements: `0x${string}`;
  };
  cctp: {
    tokenMessengerV2: `0x${string}`;
    messageTransmitterV2: `0x${string}`;
    tokenMinterV2: `0x${string}`;
  };
  gateway: {
    wallet: `0x${string}`;
    minter: `0x${string}`;
  };
  /** Circle Paymaster (ERC-4337, v0.8). Null where Circle hasn't listed it. [CIRCLE-PM] */
  circlePaymasterV08: `0x${string}` | null;
  multicall3: `0x${string}`;
  permit2: `0x${string}`;
  /** Arc-native memo extension contract. [ARC-ADDR] */
  memo: `0x${string}`;
}

// Same address on both networks: the ERC-20 view of the native USDC balance. [ARC-ADDR]
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const; // [ARC-ADDR]
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const; // [ARC-ADDR]
const MEMO = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" as const; // [ARC-ADDR]

// Native currency is USDC with 18 decimals [ARC-CONNECT].
const nativeCurrency = { name: "USDC", symbol: "USDC", decimals: USDC_NATIVE_DECIMALS } as const;

export const arcTestnet = defineChain({
  id: 5042002, // [ARC-CONNECT], verified via eth_chainId
  name: "Arc Testnet",
  nativeCurrency,
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.io"], // [ARC-CONNECT]
      webSocket: ["wss://rpc.testnet.arc.io"], // [ARC-CONNECT]
    },
  },
  blockExplorers: {
    // [ARC-CONNECT]; the older testnet.arcscan.app 301-redirects here.
    default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" },
  },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});

export const arcMainnet = defineChain({
  id: 5042, // [ARC-CONNECT], verified via eth_chainId
  name: "Arc",
  nativeCurrency,
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.arc.io"] }, // [ARC-CONNECT]
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" }, // [ARC-CONNECT]
  },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export const ARC_CHAINS: Record<ChainKey, ArcChainConfig> = {
  "arc-testnet": {
    key: "arc-testnet",
    chain: arcTestnet,
    circleBlockchain: "ARC-TESTNET", // [CIRCLE-WALLET], [AGENT-WALLET]
    explorerUrl: "https://explorer.testnet.arc.io",
    faucetUrl: "https://faucet.circle.com", // [ARC-CONNECT]
    cctpDomain: 26, // [ARC-ADDR]
    isTestnet: true,
    tokens: {
      usdc: USDC_ADDRESS,
      eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      usyc: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C",
      usycTeller: "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A",
      usycEntitlements: "0xcc205224862c7641930c87679e98999d23c26113",
    },
    cctp: {
      tokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
      messageTransmitterV2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
      tokenMinterV2: "0xb43db544E2c27092c107639Ad201b3dEfAbcF192",
    },
    gateway: {
      wallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
      minter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
    },
    circlePaymasterV08: "0x3BA9A96eE3eFf3A69E2B18886AcF52027EFF8966", // [CIRCLE-PM]
    multicall3: MULTICALL3,
    permit2: PERMIT2,
    memo: MEMO,
  },
  "arc-mainnet": {
    key: "arc-mainnet",
    chain: arcMainnet,
    // As of 2026-09-26 Circle Wallets, Contracts, Agent Wallets and Paymaster list
    // Arc Testnet only. See PROGRESS.md "Open decisions".
    circleBlockchain: null,
    explorerUrl: "https://explorer.arc.io",
    faucetUrl: null,
    cctpDomain: 26,
    isTestnet: false,
    tokens: {
      usdc: USDC_ADDRESS,
      eurc: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
      usyc: "0x8a5D989Bbb96929F689B0200f435f53dA42bF490",
      usycTeller: "0x51A8CE47dC08ba5CD19c7aa84EA6fD6664f60f9b",
      usycEntitlements: "0xb69ecb156Dc0028198028c501340d5367845ca72",
    },
    cctp: {
      tokenMessengerV2: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
      messageTransmitterV2: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
      tokenMinterV2: "0xfd78EE919681417d192449715b2594ab58f5D002",
    },
    gateway: {
      wallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
      minter: "0x2222222d7164433c4C09B0b0D809a9b52C04C205",
    },
    circlePaymasterV08: null,
    multicall3: MULTICALL3,
    permit2: PERMIT2,
    memo: MEMO,
  },
};

export function getChainConfig(
  key: string | undefined = process.env.NEXT_PUBLIC_CHAIN,
): ArcChainConfig {
  const k = (key ?? "arc-testnet") as ChainKey;
  const cfg = ARC_CHAINS[k];
  if (!cfg)
    throw new Error(`Unknown NEXT_PUBLIC_CHAIN "${key}". Expected arc-testnet | arc-mainnet.`);
  return cfg;
}

export const explorerTxUrl = (cfg: ArcChainConfig, hash: string) => `${cfg.explorerUrl}/tx/${hash}`;
export const explorerAddressUrl = (cfg: ArcChainConfig, address: string) =>
  `${cfg.explorerUrl}/address/${address}`;
