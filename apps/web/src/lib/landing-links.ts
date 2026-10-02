import { type ChainKey, getChainConfig, getDeployment } from "@misthos/shared";

const chain = (process.env.NEXT_PUBLIC_CHAIN ?? "arc-testnet") as ChainKey;
const explorer = getChainConfig(chain).explorerUrl;

export const factoryAddress = getDeployment(chain).vaultFactory ?? "";
export const explorerAddress = (a: string) => `${explorer}/address/${a}`;
