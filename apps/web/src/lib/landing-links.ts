import { getChainConfig } from "@misthos/shared/chains";
import type { ChainKey } from "@misthos/shared/chains";
import { getDeployment } from "@misthos/shared/deployments";

const chain = (process.env.NEXT_PUBLIC_CHAIN ?? "arc-testnet") as ChainKey;
const explorer = getChainConfig(chain).explorerUrl;

export const factoryAddress = getDeployment(chain).vaultFactory ?? "";
export const explorerAddress = (a: string) => `${explorer}/address/${a}`;
