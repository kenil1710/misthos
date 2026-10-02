import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { ChainError, type AgentExecutor } from "./executor";

/** Testnet fallback: the agent's EOA pays its own gas. Keys sent this process are remembered to avoid resends. */
export function eoaExecutor(wallet: WalletClient, client: PublicClient): AgentExecutor {
  const account = wallet.account;
  if (!account) throw new Error("wallet client needs an account");
  const sent = new Map<string, Hex>();
  return {
    kind: "eoa",
    address: account.address as Address,
    async send({ to, data, idempotencyKey, label }) {
      const prior = sent.get(idempotencyKey);
      if (prior) return { txHash: prior };
      let hash: Hex;
      try {
        hash = await wallet.sendTransaction({ account, chain: wallet.chain, to, data });
      } catch (e) {
        throw new ChainError(
          `${label} could not be sent: ${(e as Error).message.split("\n")[0]}`,
          false,
        );
      }
      sent.set(idempotencyKey, hash);
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (receipt.status !== "success") throw new ChainError(`${label} reverted`, false);
      return { txHash: hash };
    },
  };
}
