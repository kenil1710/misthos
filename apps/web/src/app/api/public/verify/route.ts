import { getDb } from "@misthos/db";
import { z } from "zod";
import { chainConfigById } from "@misthos/shared";
import { publicClient } from "@/lib/server/chain";
import { jsonError, readJson } from "@/lib/server/http";
import { allow, clientKey } from "@/lib/server/rate-limit";
import { explorerTx } from "@/lib/server/vault";
import { verifyChain } from "@/lib/server/verify-chain";
import { verifyDecision } from "@/lib/verify";

const Body = z.object({ record: z.string().min(2).max(50_000) });

function recordChainId(record: string): number {
  try {
    return Number((JSON.parse(record) as { chainId?: unknown }).chainId);
  } catch {
    return Number.NaN;
  }
}

/** Public: verify a pasted decision record against Misthos's records, the agent's signature and the chain. */
export async function POST(req: Request) {
  if (!allow(`verify:${clientKey(req)}`, 20, 60_000))
    return jsonError("Too many verifications. Wait a minute and try again.", 429);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("Paste a decision record to verify.", 400);
  // The record names its network (signed: a changed chainId changes the hash). verifyDecision refuses a record whose
  // network isn't its campaign's before any chain read; an unknown chain id reads nothing on-chain.
  const key = chainConfigById(recordChainId(body.data.record))?.key;
  const client = publicClient(key);
  const result = await verifyDecision(
    {
      db: getDb(),
      client,
      getReceipt: (hash) => client.getTransactionReceipt({ hash }).catch(() => null),
      explorerTx: (hash) => explorerTx(hash, key),
      chainKey: key ?? "unknown",
      chain: verifyChain(client, key),
    },
    body.data.record,
  );
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
