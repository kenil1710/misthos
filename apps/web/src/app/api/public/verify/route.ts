import { getDb } from "@misthos/db";
import { misthosVaultAbi } from "@misthos/shared/abi";
import type { Address } from "viem";
import { z } from "zod";
import { publicClient } from "@/lib/server/chain";
import { jsonError, readJson } from "@/lib/server/http";
import { allow, clientKey } from "@/lib/server/rate-limit";
import { explorerTx } from "@/lib/server/vault";
import { verifyDecision } from "@/lib/verify";

const Body = z.object({ record: z.string().min(2).max(50_000) });

/** Public: verify a pasted decision record against Misthos's records, the agent's signature and the chain. */
export async function POST(req: Request) {
  if (!allow(`verify:${clientKey(req)}`, 20, 60_000))
    return jsonError("Too many verifications. Wait a minute and try again.", 429);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("Paste a decision record to verify.", 400);
  const client = publicClient();
  const result = await verifyDecision(
    {
      db: getDb(),
      client,
      getReceipt: (hash) => client.getTransactionReceipt({ hash }).catch(() => null),
      explorerTx,
      vaultAgent: (vault) =>
        client
          .readContract({ address: vault, abi: misthosVaultAbi, functionName: "agent" })
          .then((a) => a as Address)
          .catch(() => null),
    },
    body.data.record,
  );
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
