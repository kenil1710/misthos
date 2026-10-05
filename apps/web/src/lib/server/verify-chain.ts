import "server-only";
import { misthosVaultAbi, misthosVaultFactoryAbi } from "@misthos/shared";
import type { Address, Hex, PublicClient } from "viem";
import type { VerifyDeps } from "@/lib/verify";
import { factoryAddress } from "./vault";

/**
 * On-chain reads for Verify (N-8). Nothing here trusts Misthos's database: a vault counts only if its address is the
 * factory's CREATE2 prediction for its own owner and programId, and the agent is read at a given block.
 */
export function verifyChain(client: PublicClient): VerifyDeps["chain"] {
  const read = (address: Address, functionName: "agent" | "owner" | "programId", block?: bigint) =>
    client.readContract({
      address,
      abi: misthosVaultAbi,
      functionName,
      ...(block !== undefined ? { blockNumber: block } : {}),
    } as never) as Promise<unknown>;
  return {
    agentAt: async (vault, block) => (await read(vault, "agent", block)) as Address,
    async isFactoryVault(vault) {
      // The factory salts each vault with (deployer, programId); in Misthos the owner deploys their own vault.
      const [owner, programId] = await Promise.all([
        read(vault, "owner"),
        read(vault, "programId"),
      ]);
      const predicted = (await client.readContract({
        address: factoryAddress(),
        abi: misthosVaultFactoryAbi,
        functionName: "predictVaultAddress",
        args: [owner as Address, programId as Hex],
      })) as Address;
      return predicted.toLowerCase() === vault.toLowerCase();
    },
    async blockAt(time) {
      const target = BigInt(Math.floor(time.getTime() / 1000));
      const latest = await client.getBlock();
      if (latest.timestamp <= target) return latest.number;
      // Interpolation search for the first block at or after `target`, with bisection as a fallback.
      let lo = { n: 0n, t: (await client.getBlock({ blockNumber: 0n })).timestamp };
      let hi = { n: latest.number, t: latest.timestamp };
      if (lo.t >= target) return 0n;
      for (let i = 0; i < 40 && hi.n - lo.n > 1n; i++) {
        const span = hi.t - lo.t;
        let mid = span > 0n ? lo.n + ((target - lo.t) * (hi.n - lo.n)) / span : (lo.n + hi.n) / 2n;
        if (i % 3 === 2 || mid <= lo.n || mid >= hi.n) mid = (lo.n + hi.n) / 2n;
        const b = await client.getBlock({ blockNumber: mid });
        if (b.timestamp >= target) hi = { n: mid, t: b.timestamp };
        else lo = { n: mid, t: b.timestamp };
      }
      return hi.n;
    },
  };
}
