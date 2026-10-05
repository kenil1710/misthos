import { getDb } from "@misthos/db";
import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { chainConfig, publicClient } from "@/lib/server/chain";
import { upsertWalletUser } from "@/lib/server/contributors";
import { appOrigin } from "@/lib/server/env";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { consumeNonce } from "@/lib/server/nonces";
import { startSession } from "@/lib/server/session";
import { verifySiwe } from "@/lib/server/siwe";
import { allow, clientKey } from "@/lib/server/rate-limit";

const Body = z.object({
  message: z.string().min(1).max(4000),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .max(20_000),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  if (!allow(`siwe-verify:${clientKey(req)}`, 20, 60_000))
    return jsonError("Too many sign-in attempts. Wait a minute and try again.", 429);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("invalid_body", 400);

  const result = await verifySiwe({
    message: body.data.message,
    signature: body.data.signature as `0x${string}`,
    expectedOrigin: appOrigin(),
    expectedChainId: chainConfig().chain.id,
    client: publicClient(),
    consumeNonce: (n) => consumeNonce(n, "siwe"),
  });
  if (!result.ok) return jsonError(result.error, 401);

  const db = getDb();
  const user = await upsertWalletUser(db, result.address);
  await audit(db, {
    actor: `user:${user.id}`,
    action: "owner.signed_in",
    entity: "user",
    entityId: user.id,
    data: { address: result.address },
  });
  await startSession({ sub: user.id, kind: "owner", addr: result.address });
  return Response.json({ ok: true, address: result.address });
}
