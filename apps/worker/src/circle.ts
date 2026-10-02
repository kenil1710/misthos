import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { ChainError, type AgentExecutor, type AgentSigner } from "@misthos/agent";
import type { Address, Hex } from "viem";

export type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

export function circleClient(apiKey: string, entitySecret: string): CircleClient {
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Decision-record signer backed by the agent SCA. Signatures verify via ERC-1271 (or ERC-6492 before deployment). */
export function circleSigner(
  client: CircleClient,
  walletId: string,
  address: Address,
): AgentSigner {
  return {
    kind: "erc1271",
    address,
    async signHash(hash: Hex) {
      let res;
      try {
        res = await client.signMessage({
          walletId,
          message: hash,
          encodedByHex: true,
          memo: "Misthos decision record",
        });
      } catch (e) {
        const msg =
          (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
          (e as Error).message;
        // Circle won't sign from an SCA before its first transaction; circle:setup deploys it.
        throw new ChainError(
          /undeployed/i.test(msg)
            ? "Agent SCA isn't deployed yet: run circle:setup"
            : `Circle signing failed: ${msg}`,
          !/undeployed/i.test(msg),
        );
      }
      const sig = res.data?.signature;
      if (!sig) throw new ChainError("Circle returned no signature", true);
      return sig as Hex;
    },
  };
}

const DONE = new Set(["COMPLETE", "CONFIRMED"]);
const FAILED = new Set(["FAILED", "CANCELLED", "DENIED"]);

/**
 * Contract calls from the agent SCA. Gas is sponsored by Circle Gas Station (default testnet policy for SCA wallets).
 * Circle dedupes by idempotency key, so a retried job gets the original transaction back instead of a second one.
 */
export function circleExecutor(
  client: CircleClient,
  walletId: string,
  address: Address,
  opts: { timeoutMs?: number } = {},
): AgentExecutor {
  return {
    kind: "circle-sca",
    address,
    async send({ to, data, idempotencyKey, label }) {
      let id: string | undefined;
      try {
        const created = await client.createContractExecutionTransaction({
          walletId,
          contractAddress: to,
          callData: data,
          fee: { type: "level", config: { feeLevel: "MEDIUM" } },
          idempotencyKey,
          refId: label.slice(0, 100),
        });
        id = created.data?.id;
      } catch (e) {
        const status = (e as { response?: { status?: number } }).response?.status;
        throw new ChainError(
          `Circle rejected ${label} (${status ?? "network"})`,
          status === undefined || status === 429 || status >= 500,
        );
      }
      if (!id) throw new ChainError(`Circle returned no transaction id for ${label}`, true);

      const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
      for (let delay = 500; Date.now() < deadline; delay = Math.min(delay * 1.5, 4000)) {
        await sleep(delay);
        const tx = (await client.getTransaction({ id })).data?.transaction;
        if (!tx) continue;
        if (DONE.has(tx.state) && tx.txHash) return { txHash: tx.txHash as Hex };
        if (FAILED.has(tx.state)) {
          throw new ChainError(
            `${label} ${tx.state.toLowerCase()} on-chain${tx.errorReason ? `: ${tx.errorReason}` : ""}`,
            false,
          );
        }
      }
      throw new ChainError(`${label} still pending after timeout (Circle tx ${id})`, true);
    },
  };
}
