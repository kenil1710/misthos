import {
  apiUsage,
  auditEvents,
  contributors,
  decisions,
  ensureCurrentRound,
  payouts,
  programs,
  rounds,
  submissions,
  type DbLike,
} from "@misthos/db";
import { and, asc, desc, eq, inArray, isNull, lte, gt, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { ChainError, idempotencyUuid, type AgentExecutor } from "../chain/executor";
import { fetcherFor, rejectAtPayout, type PipelineDeps } from "../pipeline";
import type { Flag } from "../types";
import { contributorIdBytes32, programIdBytes32, roundIdBytes32 } from "./ids";
import { planRound, type PayableItem, type PayeeState } from "./plan";
import { ChainRoundStatus, vaultCalls, type VaultReader } from "./vault";

export interface RoundDeps extends PipelineDeps {
  reader: VaultReader;
  executor: AgentExecutor;
}

export type RoundOutcome =
  | { status: "skipped"; reason: string }
  | { status: "nothing_to_pay" }
  | { status: "awaiting_approval"; total: bigint }
  | { status: "executed"; total: bigint; txHash: Hex }
  | { status: "failed"; error: string };

const audit = (
  db: DbLike,
  programId: string,
  action: string,
  entityId: string,
  data: Record<string, unknown>,
  entity = "round",
) =>
  db
    .insert(auditEvents)
    .values({ programId, actor: "agent", action, entity, entityId, dataJson: data });

// ─── Payees ──────────────────────────────────────────────────────────────────

/** Make the vault's payee for this contributor match their verified wallet. Idempotent. */
export async function syncPayee(
  deps: RoundDeps,
  contributorId: string,
): Promise<{ status: "skipped" | "unchanged" | "registered"; txHash?: Hex }> {
  const db = deps.db;
  const [row] = await db
    .select({ c: contributors, vault: programs.vaultAddress, programId: programs.id })
    .from(contributors)
    .innerJoin(programs, eq(programs.id, contributors.programId))
    .where(eq(contributors.id, contributorId))
    .limit(1);
  if (!row?.vault || !row.c.walletAddress || !row.c.walletVerifiedAt) return { status: "skipped" };
  const vault = row.vault as Address;
  const cb = contributorIdBytes32(row.c.id);
  const wallet = row.c.walletAddress as Address;
  const onChain = await deps.reader.payee(vault, cb);
  if (onChain.wallet?.toLowerCase() === wallet.toLowerCase()) {
    if (row.c.payeeWallet !== wallet) {
      await db
        .update(contributors)
        .set({ payeeWallet: wallet, payeeRegisteredAt: row.c.payeeRegisteredAt ?? new Date() })
        .where(eq(contributors.id, row.c.id));
    }
    return { status: "unchanged" };
  }
  const { txHash } = await deps.executor.send({
    to: vault,
    data: vaultCalls.registerPayee(cb, wallet),
    idempotencyKey: idempotencyUuid(`payee:${vault}:${cb}:${wallet.toLowerCase()}`),
    label: "registerPayee",
  });
  const after = await deps.reader.payee(vault, cb);
  await db.transaction(async (tx) => {
    await tx
      .update(contributors)
      .set({ payeeWallet: wallet, payeeTxHash: txHash, payeeRegisteredAt: new Date() })
      .where(eq(contributors.id, row.c.id));
    await audit(
      tx,
      row.programId,
      onChain.wallet ? "payee.changed" : "payee.registered",
      row.c.id,
      {
        from: onChain.wallet,
        to: wallet,
        payableAfter: after.payableAfter.toString(),
        txHash,
      },
      "contributor",
    );
  });
  return { status: "registered", txHash };
}

// ─── Rounds ──────────────────────────────────────────────────────────────────

/** Approved, unpaid, unassigned items from this round or earlier ones. */
async function payableItems(db: DbLike, programId: string, roundNumber: number) {
  return db
    .select({ s: submissions, c: contributors, roundNumber: rounds.number })
    .from(submissions)
    .innerJoin(contributors, eq(contributors.id, submissions.contributorId))
    .innerJoin(rounds, eq(rounds.id, submissions.roundId))
    .where(
      and(
        eq(submissions.programId, programId),
        inArray(submissions.status, ["approved", "partial"]),
        isNull(submissions.payoutId),
        gt(submissions.amount, 0n),
        lte(rounds.number, roundNumber),
      ),
    )
    .orderBy(asc(submissions.createdAt));
}

/** Fresh fetch before paying: content must still exist and still belong to the contributor. */
async function recheck(
  deps: RoundDeps,
  item: { s: typeof submissions.$inferSelect; c: typeof contributors.$inferSelect },
): Promise<Flag | "ok" | "unavailable"> {
  let result;
  try {
    result = await fetcherFor(deps.fetchers, item.s.sourceType)(item.s.resourceId);
  } catch {
    // Upstream trouble (rate limit, outage): defer the item rather than fail the whole round.
    return "unavailable";
  }
  if (result.usage.length) {
    await deps.db.insert(apiUsage).values(
      result.usage.map((u) => ({
        provider: u.provider,
        endpoint: `${u.endpoint} (payout recheck)`,
        units: u.units,
        estCostUsd: u.estCostUsd.toFixed(6),
        programId: item.s.programId,
      })),
    );
  }
  if (result.outcome.status === "not_found") {
    return {
      code: "DELETED",
      severity: "hard",
      message: result.outcome.detail,
      evidence: { recheckedAt: new Date().toISOString() },
    };
  }
  const r = result.outcome.resource;
  const owned =
    r.sourceType === "x_post"
      ? r.author.id === item.c.xUserId && !r.x?.isRepost
      : r.sourceType === "article"
        ? true
        : (r.author.handle ?? "").toLowerCase() === (item.c.githubLogin ?? "").toLowerCase();
  if (!owned) {
    return {
      code: "OWNERSHIP_MISMATCH",
      severity: "hard",
      message: "At payout time the content no longer belongs to the linked account.",
      evidence: { author: r.author.handle, recheckedAt: new Date().toISOString() },
    };
  }
  return "ok";
}

async function markFailed(
  db: DbLike,
  roundId: string,
  programId: string,
  error: string,
): Promise<RoundOutcome> {
  await db.transaction(async (tx) => {
    const planned = await tx
      .select({ id: payouts.id })
      .from(payouts)
      .where(eq(payouts.roundId, roundId));
    if (planned.length) {
      // Release the items so a later round can pay them.
      await tx
        .update(submissions)
        .set({ payoutId: null })
        .where(
          inArray(
            submissions.payoutId,
            planned.map((p) => p.id),
          ),
        );
      await tx.update(payouts).set({ status: "failed" }).where(eq(payouts.roundId, roundId));
    }
    await tx
      .update(rounds)
      .set({ status: "failed", lastError: error })
      .where(eq(rounds.id, roundId));
    await audit(tx, programId, "round.failed", roundId, { error });
  });
  return { status: "failed", error };
}

/**
 * Drive one round forward as far as it can go: close → re-check → register payees → plan → propose → execute
 * (or wait for owner approval). Safe to call repeatedly: each step reads DB and chain state first, and every
 * transaction uses a deterministic idempotency key.
 */
export async function runRound(
  deps: RoundDeps,
  roundId: string,
  opts: { force?: boolean } = {},
): Promise<RoundOutcome> {
  const db = deps.db;
  const now = deps.now ?? (() => new Date());
  const [row] = await db
    .select({ r: rounds, p: programs })
    .from(rounds)
    .innerJoin(programs, eq(programs.id, rounds.programId))
    .where(eq(rounds.id, roundId))
    .limit(1);
  if (!row) return { status: "skipped", reason: "not_found" };
  const { r: round, p: program } = row;
  if (!program.vaultAddress) return { status: "skipped", reason: "no_vault" };
  const vault = program.vaultAddress as Address;
  const programBytes = (program.programIdBytes32 ?? programIdBytes32(program.id)) as Hex;
  const roundBytes = (round.roundIdBytes32 ?? roundIdBytes32(round.id)) as Hex;

  // ── 1. Close ─────────────────────────────────────────────────────────
  if (round.status === "open") {
    if (round.endsAt > now() && !opts.force) return { status: "skipped", reason: "still_open" };
    const closed = await db
      .update(rounds)
      .set({
        status: "closed",
        closedAt: now(),
        ...(round.endsAt > now() ? { endsAt: now() } : {}),
      })
      .where(and(eq(rounds.id, round.id), eq(rounds.status, "open")))
      .returning({ id: rounds.id });
    if (closed.length) {
      await audit(db, program.id, "round.closed", round.id, {
        number: round.number,
        manual: round.endsAt > now(),
      });
      await ensureCurrentRound(db, program, new Date(now().getTime() + 1));
    }
  }
  const [fresh] = await db.select().from(rounds).where(eq(rounds.id, round.id));
  if (!fresh || fresh.status === "executed" || fresh.status === "failed")
    return { status: "skipped", reason: fresh?.status ?? "missing" };

  try {
    // ── 2–4. Plan (once) ─────────────────────────────────────────────────
    if (fresh.status === "closed" && !fresh.roundIdBytes32) {
      const candidates = await payableItems(db, program.id, fresh.number);
      const valid: typeof candidates = [];
      const deferredRecheck: string[] = [];
      for (const it of candidates) {
        const rc = await recheck(deps, it);
        if (rc === "ok") valid.push(it);
        else if (rc === "unavailable") deferredRecheck.push(it.s.id);
        else await rejectAtPayout(deps, it.s.id, rc);
      }

      // Payees: make sure each contributor's current wallet is registered before planning.
      const payees = new Map<string, PayeeState>();
      for (const cid of [...new Set(valid.map((v) => v.c.id))]) {
        await syncPayee(deps, cid);
        payees.set(cid, await deps.reader.payee(vault, contributorIdBytes32(cid)));
      }

      const latest = valid.length
        ? await db
            .select({
              submissionId: decisions.submissionId,
              hash: decisions.decisionHash,
              createdAt: decisions.createdAt,
            })
            .from(decisions)
            .where(
              inArray(
                decisions.submissionId,
                valid.map((v) => v.s.id),
              ),
            )
            .orderBy(desc(decisions.createdAt))
        : [];
      const hashOf = new Map<string, Hex>();
      for (const d of latest)
        if (!hashOf.has(d.submissionId)) hashOf.set(d.submissionId, d.hash as Hex);

      const limits = await deps.reader.limits(vault);
      const items: PayableItem[] = valid.map((v) => ({
        submissionId: v.s.id,
        contributorId: v.c.id,
        contributorBytes32: contributorIdBytes32(v.c.id),
        wallet: v.c.walletAddress as Address,
        amount: v.s.amount ?? 0n,
        decisionHash: hashOf.get(v.s.id)!,
        createdAt: v.s.createdAt,
      }));
      const plan = planRound({
        programBytes32: programBytes,
        roundBytes32: roundBytes,
        items,
        payees,
        limits: { ...limits, spentInWindow: await deps.reader.spentInWindow(vault) },
        nowSeconds: await deps.reader.chainTime(),
      });

      await db.transaction(async (tx) => {
        for (const p of plan.payouts) {
          const [inserted] = await tx
            .insert(payouts)
            .values({
              roundId: fresh.id,
              contributorId: p.contributorId,
              payoutIdBytes32: p.payoutId,
              toAddress: p.to.toLowerCase(),
              amount: p.amount,
              decisionHash: p.decisionHash,
              decisionRoot: plan.decisionRoot,
              status: "pending",
            })
            .returning({ id: payouts.id });
          await tx
            .update(submissions)
            .set({ payoutId: inserted!.id })
            .where(inArray(submissions.id, p.submissionIds));
        }
        await tx
          .update(rounds)
          .set({
            roundIdBytes32: roundBytes,
            totalAmount: plan.total,
            decisionRoot: plan.decisionRoot,
            lastError: null,
          })
          .where(eq(rounds.id, fresh.id));
        await audit(tx, program.id, "round.planned", fresh.id, {
          payouts: plan.payouts.length,
          total: plan.total.toString(),
          decisionRoot: plan.decisionRoot,
          deferred: [
            ...plan.deferred,
            ...deferredRecheck.map((submissionId) => ({
              submissionId,
              reason: "recheck_unavailable",
            })),
          ],
        });
      });
      if (!plan.payouts.length) {
        await audit(db, program.id, "round.nothing_to_pay", fresh.id, {});
        return { status: "nothing_to_pay" };
      }
    }

    const [planned] = await db.select().from(rounds).where(eq(rounds.id, round.id));
    const rows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.roundId, round.id))
      .orderBy(asc(payouts.createdAt), asc(payouts.payoutIdBytes32));
    if (!rows.length) return { status: "nothing_to_pay" };
    const total = rows.reduce((s, p) => s + p.amount, 0n);

    // ── 5. Propose ─────────────────────────────────────────────────────────
    let chain = await deps.reader.round(vault, roundBytes);
    if (chain.status === ChainRoundStatus.None) {
      const contributorBytes = new Map(
        rows.map((p) => [p.contributorId, contributorIdBytes32(p.contributorId)]),
      );
      const { txHash } = await deps.executor.send({
        to: vault,
        data: vaultCalls.proposeRound(
          roundBytes,
          rows.map((p) => ({
            payoutId: p.payoutIdBytes32 as Hex,
            contributorId: contributorBytes.get(p.contributorId)!,
            to: p.toAddress as Address,
            amount: p.amount,
            decisionHash: p.decisionHash as Hex,
          })),
          planned!.decisionRoot as Hex,
        ),
        idempotencyKey: idempotencyUuid(`propose:${vault}:${roundBytes}`),
        label: `proposeRound #${planned!.number}`,
      });
      await db.transaction(async (tx) => {
        await tx
          .update(rounds)
          .set({ status: "proposed", txHashPropose: txHash })
          .where(eq(rounds.id, round.id));
        await tx.update(payouts).set({ status: "proposed" }).where(eq(payouts.roundId, round.id));
        await audit(tx, program.id, "round.proposed", round.id, {
          txHash,
          total: total.toString(),
          payouts: rows.length,
        });
      });
      chain = await deps.reader.round(vault, roundBytes);
    } else if (planned!.status === "closed") {
      await db.update(rounds).set({ status: "proposed" }).where(eq(rounds.id, round.id));
    }
    if (chain.status === ChainRoundStatus.Cancelled)
      return markFailed(db, round.id, program.id, "The round was cancelled on-chain.");

    // ── 6. Execute (auto under the threshold, otherwise after the owner's approveRound) ──
    const limits = await deps.reader.limits(vault);
    const approved = chain.status === ChainRoundStatus.Approved;
    if (
      chain.status !== ChainRoundStatus.Executed &&
      !approved &&
      total > limits.autoApproveThreshold
    ) {
      const [already] = await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, round.id),
            eq(auditEvents.action, "round.awaiting_approval"),
          ),
        )
        .limit(1);
      if (!already)
        await audit(db, program.id, "round.awaiting_approval", round.id, {
          total: total.toString(),
          threshold: limits.autoApproveThreshold.toString(),
        });
      return { status: "awaiting_approval", total };
    }
    if (approved && planned!.status !== "approved")
      await db.update(rounds).set({ status: "approved" }).where(eq(rounds.id, round.id));

    // Retries reuse the idempotency key, so Circle returns the original transaction instead of sending another.
    const { txHash } = await deps.executor.send({
      to: vault,
      data: vaultCalls.executeRound(roundBytes),
      idempotencyKey: idempotencyUuid(`execute:${vault}:${roundBytes}`),
      label: `executeRound #${planned!.number}`,
    });
    for (const p of rows) {
      if (!(await deps.reader.paid(vault, p.payoutIdBytes32 as Hex)))
        throw new ChainError(`payout ${p.payoutIdBytes32} not marked paid after execution`, true);
    }
    await db.transaction(async (tx) => {
      await tx
        .update(rounds)
        .set({ status: "executed", txHashExecute: txHash, executedAt: now(), lastError: null })
        .where(eq(rounds.id, round.id));
      await tx
        .update(payouts)
        .set({ status: "executed", txHash })
        .where(eq(payouts.roundId, round.id));
      await tx
        .update(submissions)
        .set({ status: "paid" })
        .where(
          inArray(
            submissions.payoutId,
            rows.map((p) => p.id),
          ),
        );
      await audit(tx, program.id, "round.executed", round.id, {
        txHash,
        total: total.toString(),
        payouts: rows.length,
      });
      for (const p of rows) {
        await audit(
          tx,
          program.id,
          "payout.executed",
          p.id,
          {
            roundId: round.id,
            to: p.toAddress,
            amount: p.amount.toString(),
            payoutId: p.payoutIdBytes32,
            decisionHash: p.decisionHash,
            txHash,
          },
          "payout",
        );
      }
    });
    return { status: "executed", total, txHash };
  } catch (e) {
    if (e instanceof ChainError && !e.retryable)
      return markFailed(db, round.id, program.id, e.message);
    await db
      .update(rounds)
      .set({ lastError: (e as Error).message })
      .where(eq(rounds.id, round.id));
    throw e;
  }
}

/** Rounds whose window has ended for programs with a vault, oldest first. */
export async function dueRounds(db: DbLike, now: Date) {
  return db
    .select({ id: rounds.id })
    .from(rounds)
    .innerJoin(programs, eq(programs.id, rounds.programId))
    .where(
      and(
        eq(rounds.status, "open"),
        lte(rounds.endsAt, now),
        sql`${programs.vaultAddress} is not null`,
        eq(programs.status, "active"),
      ),
    )
    .orderBy(asc(rounds.endsAt))
    .limit(20);
}
