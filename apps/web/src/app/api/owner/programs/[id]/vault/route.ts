import { contributors, getDb, programs } from "@misthos/db";
import { QUEUES, type StoredLimits } from "@misthos/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Hex } from "viem";
import { audit } from "@/lib/server/audit";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { requireProgramOwner, TxBody } from "@/lib/server/owner";
import { enqueue } from "@/lib/server/queue";
import {
  agentAddress,
  ChainVerifyError,
  findVaultCreated,
  programIdBytes32,
  readVault,
} from "@/lib/server/vault";

/** Record the vault after the owner's createVault transaction, once its VaultCreated event checks out. */
export async function POST(req: Request, ctx: RouteContext<"/api/owner/programs/[id]/vault">) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const owner = await requireProgramOwner((await ctx.params).id);
  if (owner instanceof Response) return owner;
  const { session, program } = owner;
  if (program.vaultAddress) return jsonError("This program already has a vault.", 409);
  const body = TxBody.safeParse(await readJson(req));
  if (!body.success) return jsonError("invalid_body", 400);

  let created;
  try {
    created = await findVaultCreated(body.data.txHash as Hex);
  } catch (e) {
    if (e instanceof ChainVerifyError) return jsonError(e.message, 400);
    throw e;
  }
  const expectedAgent = agentAddress();
  if (created.programId !== programIdBytes32(program.id))
    return jsonError("That vault was created for a different program.", 400);
  if (created.owner.toLowerCase() !== session.addr.toLowerCase())
    return jsonError("The vault owner isn't your signed-in wallet.", 400);
  if (!expectedAgent || created.agent.toLowerCase() !== expectedAgent.toLowerCase())
    return jsonError("The vault's agent isn't the Misthos agent wallet.", 400);

  // Limits on-chain are the source of truth from here on.
  const state = await readVault(created.vault);
  const limits: StoredLimits = {
    ...program.limitsJson,
    maxPerPayout: state.limits.maxPerPayout.toString(),
    maxPerRound: state.limits.maxPerRound.toString(),
    maxPerDay: state.limits.maxPerDay.toString(),
    autoApproveThreshold: state.limits.autoApproveThreshold.toString(),
    payeeCooldownSeconds: Number(state.limits.payeeCooldown),
  };
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(programs)
      .set({
        vaultAddress: created.vault.toLowerCase(),
        programIdBytes32: created.programId,
        limitsJson: limits,
      })
      .where(eq(programs.id, program.id));
    await audit(tx, {
      programId: program.id,
      actor: `user:${session.sub}`,
      action: "vault.deployed",
      entity: "program",
      entityId: program.id,
      data: {
        vault: created.vault,
        txHash: body.data.txHash,
        block: created.blockNumber.toString(),
        agent: created.agent,
      },
    });
  });
  // Register everyone who already joined.
  const joined = await db
    .select({ id: contributors.id, wallet: contributors.walletAddress })
    .from(contributors)
    .where(and(eq(contributors.programId, program.id), isNotNull(contributors.walletVerifiedAt)));
  for (const c of joined)
    await enqueue(QUEUES.syncPayee, { contributorId: c.id }, `payee:${c.id}:${c.wallet}`);
  return Response.json({ ok: true, vault: created.vault });
}
