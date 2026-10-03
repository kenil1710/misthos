import { auditEvents, getDb } from "@misthos/db";
import { and, eq, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { audit } from "@/lib/server/audit";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { requireProgramOwner, TxBody } from "@/lib/server/owner";
import { ChainVerifyError, findVaultEvent, vaultChanged } from "@/lib/server/vault";

/** Record a deposit made from the treasury page (deposits made elsewhere still show in the on-chain totals). */
export async function POST(req: Request, ctx: RouteContext<"/api/owner/programs/[id]/deposit">) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
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
      "Deposited",
    );
  } catch (e) {
    if (e instanceof ChainVerifyError) return jsonError(e.message, 400);
    throw e;
  }
  const db = getDb();
  const [dupe] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.programId, program.id),
        eq(auditEvents.action, "vault.deposit"),
        sql`${auditEvents.dataJson}->>'txHash' = ${body.data.txHash}`,
      ),
    )
    .limit(1);
  if (!dupe) {
    await audit(db, {
      programId: program.id,
      actor: `user:${session.sub}`,
      action: "vault.deposit",
      entity: "program",
      entityId: program.id,
      data: {
        from: found.log.args.from,
        amount: found.log.args.amount.toString(),
        txHash: body.data.txHash,
      },
    });
  }
  vaultChanged(program.vaultAddress);
  return Response.json({ ok: true });
}
