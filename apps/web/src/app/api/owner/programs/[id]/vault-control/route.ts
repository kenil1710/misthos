import { auditEvents, getDb } from "@misthos/db";
import { and, eq, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { audit } from "@/lib/server/audit";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { requireProgramOwner, TxBody } from "@/lib/server/owner";
import { ChainVerifyError, findVaultEvent } from "@/lib/server/vault";

const EVENTS = { withdraw: "Withdrawn", pause: "Paused", unpause: "Unpaused" } as const;

/** Record an owner withdraw / pause / unpause after checking its event on-chain. */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/owner/programs/[id]/vault-control">,
) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const action = new URL(req.url).searchParams.get("action");
  if (action !== "withdraw" && action !== "pause" && action !== "unpause")
    return jsonError("invalid_action", 400);
  const owner = await requireProgramOwner((await ctx.params).id);
  if (owner instanceof Response) return owner;
  const { session, program } = owner;
  if (!program.vaultAddress) return jsonError("Deploy the vault first.", 409);
  const body = TxBody.safeParse(await readJson(req));
  if (!body.success) return jsonError("invalid_body", 400);
  let found;
  try {
    found = await findVaultEvent(
      body.data.txHash as Hex,
      program.vaultAddress as Address,
      EVENTS[action],
    );
  } catch (e) {
    if (e instanceof ChainVerifyError) return jsonError(e.message, 400);
    throw e;
  }
  const args = found.log.args as Record<string, unknown>;
  const name = `vault.${action === "withdraw" ? "withdrawn" : action === "pause" ? "paused" : "unpaused"}`;
  const db = getDb();
  // Retries post the same transaction again; record it once.
  const [dupe] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.programId, program.id),
        eq(auditEvents.action, name),
        sql`${auditEvents.dataJson}->>'txHash' = ${body.data.txHash}`,
      ),
    )
    .limit(1);
  if (dupe) return Response.json({ ok: true });
  await audit(db, {
    programId: program.id,
    actor: `user:${session.sub}`,
    action: name,
    entity: "program",
    entityId: program.id,
    data:
      action === "withdraw"
        ? { amount: String(args.amount), to: String(args.to), txHash: body.data.txHash }
        : { txHash: body.data.txHash },
  });
  return Response.json({ ok: true });
}
