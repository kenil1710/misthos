import { getDb, programs } from "@misthos/db";
import { eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { audit } from "@/lib/server/audit";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { requireProgramOwner, TxBody } from "@/lib/server/owner";
import { ChainVerifyError, findVaultEvent, readVault, vaultChanged } from "@/lib/server/vault";

/** After the owner's setLimits transaction: confirm LimitsUpdated, then copy the on-chain limits into the program. */
export async function POST(req: Request, ctx: RouteContext<"/api/owner/programs/[id]/limits">) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const owner = await requireProgramOwner((await ctx.params).id);
  if (owner instanceof Response) return owner;
  const { session, program } = owner;
  if (!program.vaultAddress) return jsonError("Deploy the vault first.", 409);
  const body = TxBody.safeParse(await readJson(req));
  if (!body.success) return jsonError("invalid_body", 400);
  try {
    await findVaultEvent(body.data.txHash as Hex, program.vaultAddress as Address, "LimitsUpdated");
  } catch (e) {
    if (e instanceof ChainVerifyError) return jsonError(e.message, 400);
    throw e;
  }
  const { limits: l } = await readVault(program.vaultAddress as Address);
  const next = {
    ...program.limitsJson,
    maxPerPayout: l.maxPerPayout.toString(),
    maxPerRound: l.maxPerRound.toString(),
    maxPerDay: l.maxPerDay.toString(),
    autoApproveThreshold: l.autoApproveThreshold.toString(),
    payeeCooldownSeconds: Number(l.payeeCooldown),
  };
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(programs).set({ limitsJson: next }).where(eq(programs.id, program.id));
    await audit(tx, {
      programId: program.id,
      actor: `user:${session.sub}`,
      action: "vault.limits_updated",
      entity: "program",
      entityId: program.id,
      data: { ...next, txHash: body.data.txHash },
    });
  });
  vaultChanged(program.vaultAddress);
  return Response.json({ ok: true, limits: next });
}
