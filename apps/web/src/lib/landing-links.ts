import { getChainConfig } from "@misthos/shared/chains";
import type { ChainKey } from "@misthos/shared/chains";
import { getDeployment } from "@misthos/shared/deployments";

const chain = (process.env.NEXT_PUBLIC_CHAIN ?? "arc-testnet") as ChainKey;

export const factoryAddress = getDeployment(chain).vaultFactory ?? "";
/** An address on a network's explorer (default: the app's primary network). */
export const explorerAddress = (a: string, network: string = chain) =>
  `${getChainConfig(network).explorerUrl}/address/${a}`;
