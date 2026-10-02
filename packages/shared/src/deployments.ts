import type { ChainKey } from "./chains";
import raw from "./deployments.json" with { type: "json" };

/** Addresses written by `packages/contracts/script/Deploy.s.sol` and `CreateVault.s.sol`. */
export interface Deployment {
  chainId: number;
  vaultImplementation: `0x${string}` | null;
  vaultFactory: `0x${string}` | null;
  deployBlock: number | null;
  /** Phase 1 smoke-test vault (owner = deployer); not a real program. */
  smokeVault: `0x${string}` | null;
}

export const DEPLOYMENTS = raw as Record<ChainKey, Deployment>;

export function getDeployment(chain: ChainKey): Deployment {
  return DEPLOYMENTS[chain];
}
