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
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, gt, or, sql } from "drizzle-orm";
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
  /** How long a run's lease on a round lasts without renewal (default 5 min; renewed before every transaction). */
  roundLeaseMs?: number;
}

export type RoundOutcome =
  | { status: "skipped"; reason: string }
  | { status: "nothing_to_pay" }
  | { status: "awaiting_approval"; total: bigint }
  | { status: "awaiting_funds"; total: bigint; balance: bigint }
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

/** True while one of this contributor's payouts is planned or proposed in a round that hasn't executed yet. */
async function hasPayoutInFlight(db: DbLike, contributorId: string) {
  const [row] = await db
    .select({ id: payouts.id })
    .from(payouts)
    .innerJoin(rounds, eq(rounds.id, payouts.roundId))
    .where(
      and(
        eq(payouts.contributorId, contributorId),
        inArray(payouts.status, ["pending", "proposed"]),
        inArray(rounds.status, ["closed", "proposed", "approved"]),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Make the vault's payee for this contributor match their verified wallet. Idempotent.
 *
 * A wallet *change* waits while the contributor has a payout in flight: the vault re-checks every payee when a round
 * executes, so changing it mid-round would revert the round for everyone. It applies after the round (runRound
 * re-syncs the round's contributors once it executes or is released).
 */
export async function syncPayee(
  deps: RoundDeps,
  contributorId: string,
): Promise<{ status: "skipped" | "unchanged" | "registered" | "deferred"; txHash?: Hex }> {
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
  if (onChain.wallet && (await hasPayoutInFlight(db, row.c.id))) {
    await audit(
      db,
      row.programId,
      "payee.change_deferred",
      row.c.id,
      { from: onChain.wallet, to: wallet, reason: "payout_in_flight" },
      "contributor",
    );
    return { status: "deferred" };
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

/** A payout re-check this recent is reused: a re-plan or retry doesn't fetch the same content again (N-2). */
const RECHECK_FRESH_MS = 6 * 3600_000;

/** Fresh fetch before paying: content must still exist and still belong to the contributor. */
async function recheck(
  deps: RoundDeps,
  item: { s: typeof submissions.$inferSelect; c: typeof contributors.$inferSelect },
): Promise<Flag | "ok" | "unavailable"> {
  const now = (deps.now ?? (() => new Date()))();
  if (item.s.recheckedAt && now.getTime() - item.s.recheckedAt.getTime() < RECHECK_FRESH_MS)
    return "ok";
  const outcome = await recheckFetch(deps, item);
  if (outcome === "ok")
    await deps.db
      .update(submissions)
      .set({ recheckedAt: now })
      .where(eq(submissions.id, item.s.id));
  return outcome;
}

async function recheckFetch(
  deps: RoundDeps,
  item: { s: typeof submissions.$inferSelect; c: typeof contributors.$inferSelect },
): Promise<Flag | "ok" | "unavailable"> {
  let result;
  try {
    // Existence and ownership only: the post itself, not its thread (saves the search).
    result =
      item.s.sourceType === "x_post"
        ? await deps.fetchers.x(item.s.resourceId, { thread: false })
        : await fetcherFor(deps.fetchers, item.s.sourceType)(item.s.resourceId);
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
        : // GitHub: the numeric user id, like the original check; a renamed account still matches.
          !!r.author.id && r.author.id === item.c.githubUserId;
  if (!owned) {
    return {
      code: "OWNERSHIP_MISMATCH",
      severity: "hard",
      message: "At payout time the content no longer belongs to the linked account.",
      evidence: {
        author: r.author.handle,
        authorId: r.author.id,
        recheckedAt: new Date().toISOString(),
      },
    };
  }
  return "ok";
}

/**
 * Give back the items of one on-chain round id, but only what the vault confirms was never paid. Callers reach this
 * only after the chain says that id can't execute any more (never proposed, or cancelled). Payouts planned under any
 * other id (a re-plan by another run) are never touched, and the round is marked failed only if it is still on this
 * id (N-1).
 */
async function releaseRound(
  deps: RoundDeps,
  vault: Address,
  roundId: string,
  programId: string,
  error: string,
  roundBytes: Hex | null,
): Promise<RoundOutcome> {
  const db = deps.db;
  const planned = roundBytes
    ? await db
        .select({
          id: payouts.id,
          payoutId: payouts.payoutIdBytes32,
          contributorId: payouts.contributorId,
        })
        .from(payouts)
        .where(
          and(
            eq(payouts.roundId, roundId),
            eq(payouts.roundIdBytes32, roundBytes),
            inArray(payouts.status, ["pending", "proposed"]),
          ),
        )
    : [];
  const unpaid: string[] = [];
  for (const p of planned)
    if (!(await deps.reader.paid(vault, p.payoutId as Hex))) unpaid.push(p.id);
  await db.transaction(async (tx) => {
    if (unpaid.length) {
      await tx
        .update(submissions)
        .set({ payoutId: null })
        .where(inArray(submissions.payoutId, unpaid));
      await tx.update(payouts).set({ status: "failed" }).where(inArray(payouts.id, unpaid));
    }
    await tx
      .update(rounds)
      .set({ status: "failed", lastError: error })
      .where(
        and(
          eq(rounds.id, roundId),
          roundBytes ? eq(rounds.roundIdBytes32, roundBytes) : isNull(rounds.roundIdBytes32),
        ),
      );
    await audit(tx, programId, "round.failed", roundId, {
      error,
      roundId: roundBytes,
      released: unpaid.length,
      keptPaid: planned.length - unpaid.length,
    });
  });
  await resyncPayees(deps, [...new Set(planned.map((p) => p.contributorId))]);
  return { status: "failed", error };
}

/** Apply wallet changes that waited for this round (best effort; the next round retries). */
async function resyncPayees(deps: RoundDeps, contributorIds: string[]) {
  for (const cid of contributorIds) await syncPayee(deps, cid).catch(() => undefined);
}

/**
 * A step failed for good. Never trust the error alone: read the round on-chain and act on what happened there.
 * Executed → record it as paid. Proposed/approved → cancel it on-chain first, then release. Only a chain-confirmed
 * "can't execute" ever gives items back, so nothing can be paid twice.
 */
async function settleFailure(
  deps: RoundDeps,
  ctx: RunCtx,
  error: string,
  roundBytes: Hex | null,
): Promise<RoundOutcome> {
  // Act on the on-chain id this run was working on, never on whatever the database says now (N-1). If another run
  // has since moved the round to a new id, that run owns it: this one only makes sure its own id is settled.
  const [cur] = await deps.db.select().from(rounds).where(eq(rounds.id, ctx.roundId));
  if (roundBytes && cur?.roundIdBytes32 && cur.roundIdBytes32 !== roundBytes) {
    const chain = await deps.reader.round(ctx.vault, roundBytes);
    if (chain.status === ChainRoundStatus.Proposed || chain.status === ChainRoundStatus.Approved)
      await cancelOnChain(deps, ctx, roundBytes);
    return { status: "skipped", reason: "superseded" };
  }
  if (!roundBytes) return releaseRound(deps, ctx.vault, ctx.roundId, ctx.programId, error, null);
  const chain = await deps.reader.round(ctx.vault, roundBytes);
  if (chain.status === ChainRoundStatus.Executed)
    return recordExecuted(deps, ctx, roundBytes, null);
  if (chain.status === ChainRoundStatus.Proposed || chain.status === ChainRoundStatus.Approved) {
    await cancelOnChain(deps, ctx, roundBytes);
  }
  return releaseRound(deps, ctx.vault, ctx.roundId, ctx.programId, error, roundBytes);
}

/** cancelRound, then confirm on-chain. Throws (retryable) unless the vault says Cancelled. */
async function cancelOnChain(deps: RoundDeps, ctx: RunCtx, roundBytes: Hex) {
  const { vault, number } = ctx;
  const before = await deps.reader.round(vault, roundBytes);
  if (before.status === ChainRoundStatus.Proposed || before.status === ChainRoundStatus.Approved) {
    await ctx.renew();
    try {
      await deps.executor.send({
        to: vault,
        data: vaultCalls.cancelRound(roundBytes),
        idempotencyKey: idempotencyUuid(`cancel:${vault}:${roundBytes}`),
        label: `cancelRound #${number}`,
      });
    } catch (e) {
      // Whatever the send says, the chain decides below.
      if (!(e instanceof ChainError)) throw e;
    }
  }
  const after = await deps.reader.round(vault, roundBytes);
  if (after.status !== ChainRoundStatus.Cancelled && after.status !== ChainRoundStatus.None)
    throw new ChainError(
      `Round #${number} could not be confirmed cancelled on-chain (status ${after.status}); its items stay locked.`,
      true,
    );
}

/** Record an executed round from chain state: every payout must be marked paid by the vault. Idempotent. */
async function recordExecuted(
  deps: RoundDeps,
  ctx: RunCtx,
  roundBytes: Hex,
  txHash: Hex | null,
): Promise<RoundOutcome> {
  const db = deps.db;
  const now = deps.now ?? (() => new Date());
  const [cur] = await db.select().from(rounds).where(eq(rounds.id, ctx.roundId));
  // Only the payouts of the on-chain id that executed (N-1).
  const rows = await db
    .select()
    .from(payouts)
    .where(
      and(
        eq(payouts.roundId, ctx.roundId),
        eq(payouts.roundIdBytes32, roundBytes),
        inArray(payouts.status, ["pending", "proposed", "executed"]),
      ),
    );
  for (const p of rows) {
    if (!(await deps.reader.paid(ctx.vault, p.payoutIdBytes32 as Hex)))
      throw new ChainError(`payout ${p.payoutIdBytes32} not marked paid after execution`, true);
  }
  const tx = txHash ?? (await deps.reader.executedTx(ctx.vault, roundBytes).catch(() => null));
  const total = rows.reduce((s, p) => s + p.amount, 0n);
  if (cur!.status !== "executed") {
    await db.transaction(async (t) => {
      await t
        .update(rounds)
        .set({ status: "executed", txHashExecute: tx, executedAt: now(), lastError: null })
        .where(and(eq(rounds.id, ctx.roundId), eq(rounds.roundIdBytes32, roundBytes)));
      await t
        .update(payouts)
        .set({ status: "executed", txHash: tx })
        .where(
          inArray(
            payouts.id,
            rows.map((p) => p.id),
          ),
        );
      await t
        .update(submissions)
        .set({ status: "paid" })
        .where(
          inArray(
            submissions.payoutId,
            rows.map((p) => p.id),
          ),
        );
      await audit(t, ctx.programId, "round.executed", ctx.roundId, {
        txHash: tx,
        total: total.toString(),
        payouts: rows.length,
        ...(txHash ? {} : { recoveredFromChain: true }),
      });
      for (const p of rows) {
        await audit(
          t,
          ctx.programId,
          "payout.executed",
          p.id,
          {
            roundId: ctx.roundId,
            to: p.toAddress,
            amount: p.amount.toString(),
            payoutId: p.payoutIdBytes32,
            decisionHash: p.decisionHash,
            txHash: tx,
          },
          "payout",
        );
      }
    });
  }
  await resyncPayees(deps, [...new Set(rows.map((p) => p.contributorId))]);
  return { status: "executed", total, txHash: (tx ?? "0x") as Hex };
}

/**
 * Before executing: every payout's payee must still match on-chain, be out of cooldown, and be able to receive
 * the token. One that can't would revert the whole round for everyone (F-02).
 */
async function preflight(
  deps: RoundDeps,
  vault: Address,
  rows: (typeof payouts.$inferSelect)[],
): Promise<{ contributorId: string; reason: string }[]> {
  // (The vault's balance is checked first, in runRound: an under-funded vault would fail every transfer simulation.)
  const now = await deps.reader.chainTime();
  const blocked: { contributorId: string; reason: string }[] = [];
  for (const p of rows) {
    const payee = await deps.reader.payee(vault, contributorIdBytes32(p.contributorId));
    const reason =
      payee.wallet?.toLowerCase() !== p.toAddress.toLowerCase()
        ? "payee_changed"
        : payee.payableAfter > now
          ? "payee_cooldown"
          : !(await deps.reader.canReceive(vault, p.toAddress as Address, p.amount))
            ? "recipient_cannot_receive"
            : null;
    if (reason) blocked.push({ contributorId: p.contributorId, reason });
  }
  return blocked;
}

/**
 * The agent's own approval guard (F-06): auto-execute only while this program's auto-paid total over the last 24 h,
 * plus this round, stays under the owner's threshold. Splitting work into small rounds can't skip the owner. (The
 * vault itself checks the threshold per round; a compromised agent is bounded by maxPerDay, see SECURITY.md.)
 */
async function autoPaidLast24h(db: DbLike, programId: string, now: Date) {
  const [r] = await db
    .select({ total: sql<string>`coalesce(sum(${rounds.totalAmount}), 0)::text` })
    .from(rounds)
    .where(
      and(
        eq(rounds.programId, programId),
        eq(rounds.status, "executed"),
        isNull(rounds.txHashApprove),
        gt(rounds.executedAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
  return BigInt(r?.total ?? "0");
}

/** How many times one run may cancel and re-plan a round around payees that can't be paid. */
const MAX_REPLANS = 3;
/** Across all runs: after this many re-plans the round is cancelled and its items carry over to the next round. */
const MAX_TOTAL_REPLANS = 10;
const DEFAULT_LEASE_MS = 5 * 60_000;

interface RunCtx {
  vault: Address;
  roundId: string;
  programId: string;
  number: number;
  /** Extend this run's lease; throws if another run has taken the round (then nothing more may be sent). */
  renew: () => Promise<void>;
}

/** Thrown when a run no longer holds its round's lease. Retryable: the run that holds it carries on. */
export class LeaseLostError extends Error {
  constructor(roundId: string) {
    super(
      `Another worker run took over round ${roundId}; this run stopped before sending anything.`,
    );
    this.name = "LeaseLostError";
  }
}

/**
 * Take the round's lease for this run (N-1): only one run may process a round at a time, across processes too
 * (e.g. the old and new container during a deploy). Database time, so worker clocks don't matter.
 */
async function takeLease(db: DbLike, roundId: string, owner: string, ms: number) {
  const got = await db
    .update(rounds)
    .set({ lockOwner: owner, lockUntil: sql`now() + make_interval(secs => ${ms / 1000})` })
    .where(
      and(
        eq(rounds.id, roundId),
        or(isNull(rounds.lockUntil), sql`${rounds.lockUntil} < now()`, eq(rounds.lockOwner, owner)),
      ),
    )
    .returning({ id: rounds.id });
  return got.length > 0;
}

async function dropLease(db: DbLike, roundId: string, owner: string) {
  await db
    .update(rounds)
    .set({ lockOwner: null, lockUntil: null })
    .where(and(eq(rounds.id, roundId), eq(rounds.lockOwner, owner)));
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
  const leaseMs = deps.roundLeaseMs ?? DEFAULT_LEASE_MS;
  const owner = `${process.pid}:${randomUUID()}`;
  if (!(await takeLease(db, round.id, owner, leaseMs)))
    return { status: "skipped", reason: "locked" };
  try {
    return await runLocked(deps, { round, program, vault, programBytes, owner, leaseMs }, opts);
  } finally {
    await dropLease(db, round.id, owner).catch(() => undefined);
  }
}

async function runLocked(
  deps: RoundDeps,
  run: {
    round: typeof rounds.$inferSelect;
    program: typeof programs.$inferSelect;
    vault: Address;
    programBytes: Hex;
    owner: string;
    leaseMs: number;
  },
  opts: { force?: boolean },
): Promise<RoundOutcome> {
  const db = deps.db;
  const now = deps.now ?? (() => new Date());
  const { round, program, vault, programBytes } = run;

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
    }
  }
  // Open the next round whenever this one is past "open", not only in the run that closed it: a worker that died
  // between closing and opening would otherwise leave the program without an open round. Idempotent.
  await ensureCurrentRound(db, program, new Date(now().getTime() + 1));
  const [fresh] = await db.select().from(rounds).where(eq(rounds.id, round.id));
  if (!fresh || fresh.status === "executed" || fresh.status === "failed")
    return { status: "skipped", reason: fresh?.status ?? "missing" };

  const ctx: RunCtx = {
    vault,
    roundId: round.id,
    programId: program.id,
    number: round.number,
    renew: async () => {
      if (!(await takeLease(db, round.id, run.owner, run.leaseMs)))
        throw new LeaseLostError(round.id);
    },
  };
  /** Contributors dropped from this round by the payee pre-flight, with why (they carry over). */
  const exclude = new Map<string, string>();
  /** The on-chain id this run is working on: what a failure is settled against. */
  let working: Hex | null = null;
  try {
    for (let attempt = 0; ; attempt++) {
      await ctx.renew();
      const [cur] = await db.select().from(rounds).where(eq(rounds.id, round.id));
      if (!cur || cur.status === "executed" || cur.status === "failed")
        return { status: "skipped", reason: cur?.status ?? "missing" };
      // A re-plan gives the round a fresh on-chain id (a cancelled id can't be reused).
      const roundBytes = (cur.roundIdBytes32 ?? roundIdBytes32(round.id)) as Hex;
      working = cur.roundIdBytes32 ? roundBytes : null;

      // ── 2–4. Plan (once per on-chain id; a re-plan clears the decision root) ──
      if (cur.status === "closed" && (!cur.roundIdBytes32 || !cur.decisionRoot)) {
        const all = await payableItems(db, program.id, cur.number);
        // Contributors carried over by an earlier attempt of this run (their payee can't be paid right now).
        const candidates = all.filter((it) => !exclude.has(it.c.id));
        const valid: typeof candidates = [];
        const deferredRecheck: string[] = [];
        for (const it of candidates) {
          await ctx.renew();
          const rc = await recheck(deps, it);
          if (rc === "ok") valid.push(it);
          else if (rc === "unavailable") deferredRecheck.push(it.s.id);
          else await rejectAtPayout(deps, it.s.id, rc);
        }

        // Payees: make sure each contributor's current wallet is registered before planning.
        const payees = new Map<string, PayeeState>();
        for (const cid of [...new Set(valid.map((v) => v.c.id))]) {
          await ctx.renew();
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
                roundId: cur.id,
                contributorId: p.contributorId,
                payoutIdBytes32: p.payoutId,
                roundIdBytes32: roundBytes,
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
            .where(eq(rounds.id, cur.id));
          working = roundBytes;
          await audit(tx, program.id, "round.planned", cur.id, {
            payouts: plan.payouts.length,
            total: plan.total.toString(),
            decisionRoot: plan.decisionRoot,
            deferred: [
              ...plan.deferred,
              ...deferredRecheck.map((submissionId) => ({
                submissionId,
                reason: "recheck_unavailable",
              })),
              ...all
                .filter((it) => exclude.has(it.c.id))
                .map((it) => ({ submissionId: it.s.id, reason: exclude.get(it.c.id)! })),
            ],
          });
        });
        if (!plan.payouts.length) {
          await audit(db, program.id, "round.nothing_to_pay", cur.id, {});
          return { status: "nothing_to_pay" };
        }
      }

      const [planned] = await db.select().from(rounds).where(eq(rounds.id, round.id));
      const rows = await db
        .select()
        .from(payouts)
        .where(
          and(
            eq(payouts.roundId, round.id),
            eq(payouts.roundIdBytes32, roundBytes),
            inArray(payouts.status, ["pending", "proposed"]),
          ),
        )
        .orderBy(asc(payouts.createdAt), asc(payouts.payoutIdBytes32));
      if (!rows.length) return { status: "nothing_to_pay" };
      const total = rows.reduce((s, p) => s + p.amount, 0n);

      // ── 5. Propose ─────────────────────────────────────────────────────────
      let chain = await deps.reader.round(vault, roundBytes);
      if (chain.status === ChainRoundStatus.None) {
        const contributorBytes = new Map(
          rows.map((p) => [p.contributorId, contributorIdBytes32(p.contributorId)]),
        );
        await ctx.renew();
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
          // Only if the round is still on this id (N-1): never overwrite a round another run re-planned.
          const moved = await tx
            .update(rounds)
            .set({ status: "proposed", txHashPropose: txHash })
            .where(and(eq(rounds.id, round.id), eq(rounds.roundIdBytes32, roundBytes)))
            .returning({ id: rounds.id });
          if (!moved.length) throw new LeaseLostError(round.id);
          await tx
            .update(payouts)
            .set({ status: "proposed" })
            .where(
              inArray(
                payouts.id,
                rows.map((p) => p.id),
              ),
            );
          await audit(tx, program.id, "round.proposed", round.id, {
            txHash,
            total: total.toString(),
            payouts: rows.length,
          });
        });
        chain = await deps.reader.round(vault, roundBytes);
      } else if (planned!.status === "closed") {
        await db
          .update(rounds)
          .set({ status: "proposed" })
          .where(and(eq(rounds.id, round.id), eq(rounds.roundIdBytes32, roundBytes)));
      }
      // The chain decides from here (F-01): already executed → record it; cancelled → release.
      if (chain.status === ChainRoundStatus.Executed)
        return recordExecuted(deps, ctx, roundBytes, null);
      if (chain.status === ChainRoundStatus.Cancelled)
        return releaseRound(
          deps,
          vault,
          round.id,
          program.id,
          "The round was cancelled on-chain.",
          roundBytes,
        );

      // ── 5a. Funds (N-6): an under-funded vault waits for a deposit; the owner's approval is kept ──
      const balance = await deps.reader.vaultFunds(vault);
      if (balance < total) {
        const message = `Vault needs funds: it holds ${formatUnits6(balance)} USDC and this round pays ${formatUnits6(total)} USDC. Deposit at least ${formatUnits6(total - balance)} USDC; the round pays as soon as the vault is funded.`;
        if (cur.lastError !== message) {
          await db
            .update(rounds)
            .set({ lastError: message })
            .where(and(eq(rounds.id, round.id), eq(rounds.roundIdBytes32, roundBytes)));
          await audit(db, program.id, "round.awaiting_funds", round.id, {
            roundId: roundBytes,
            balance: balance.toString(),
            total: total.toString(),
          });
        }
        return { status: "awaiting_funds", total, balance };
      }

      // ── 5b. Payee pre-flight (F-02): drop payouts that would revert the round, re-plan the rest ──
      const blocked = await preflight(deps, vault, rows);
      if (blocked.length) {
        if (cur.replanCount >= MAX_TOTAL_REPLANS)
          throw new ChainError(
            `Payees still couldn't be paid after ${MAX_TOTAL_REPLANS} re-plans; the round is cancelled and its items carry over.`,
            false,
          );
        if (attempt >= MAX_REPLANS)
          throw new ChainError(`Payees still can't be paid after ${MAX_REPLANS} re-plans`, true);
        await cancelOnChain(deps, ctx, roundBytes);
        // Release only this id's payouts, and only those the vault confirms unpaid (N-1).
        for (const p of rows)
          if (await deps.reader.paid(vault, p.payoutIdBytes32 as Hex))
            throw new ChainError(
              `payout ${p.payoutIdBytes32} is marked paid on a cancelled round`,
              true,
            );
        for (const b of blocked) exclude.set(b.contributorId, b.reason);
        const next = cur.replanCount + 1;
        await db.transaction(async (tx) => {
          const ids = rows.map((p) => p.id);
          await tx
            .update(submissions)
            .set({ payoutId: null })
            .where(inArray(submissions.payoutId, ids));
          await tx.update(payouts).set({ status: "failed" }).where(inArray(payouts.id, ids));
          await tx
            .update(rounds)
            .set({
              status: "closed",
              // A fresh id from the persistent counter: never a cancelled one, in this run or a later one (N-2).
              roundIdBytes32: roundIdBytes32(`${round.id}:retry${next}`),
              replanCount: next,
              decisionRoot: null,
              totalAmount: 0n,
              txHashPropose: null,
              txHashApprove: null,
              lastError: null,
            })
            .where(and(eq(rounds.id, round.id), eq(rounds.roundIdBytes32, roundBytes)));
          await audit(tx, program.id, "round.replanned", round.id, {
            cancelledRoundId: roundBytes,
            attempt: next,
            carriedOver: blocked,
          });
        });
        continue;
      }

      // ── 6. Execute (auto under the threshold, otherwise after the owner's approveRound) ──
      const limits = await deps.reader.limits(vault);
      const approved = chain.status === ChainRoundStatus.Approved;
      const overThreshold =
        total > limits.autoApproveThreshold ||
        (await autoPaidLast24h(db, program.id, now())) + total > limits.autoApproveThreshold;
      if (!approved && overThreshold) {
        const [already] = await db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityId, round.id),
              eq(auditEvents.action, "round.awaiting_approval"),
              sql`${auditEvents.dataJson}->>'roundId' = ${roundBytes}`,
            ),
          )
          .limit(1);
        if (!already)
          await audit(db, program.id, "round.awaiting_approval", round.id, {
            total: total.toString(),
            threshold: limits.autoApproveThreshold.toString(),
            roundId: roundBytes,
          });
        return { status: "awaiting_approval", total };
      }
      if (approved && planned!.status !== "approved")
        await db
          .update(rounds)
          .set({ status: "approved" })
          .where(and(eq(rounds.id, round.id), eq(rounds.roundIdBytes32, roundBytes)));

      // Retries reuse the idempotency key, so Circle returns the original transaction instead of sending another.
      await ctx.renew();
      const { txHash } = await deps.executor.send({
        to: vault,
        data: vaultCalls.executeRound(roundBytes),
        idempotencyKey: idempotencyUuid(`execute:${vault}:${roundBytes}`),
        label: `executeRound #${planned!.number}`,
      });
      return recordExecuted(deps, ctx, roundBytes, txHash);
    }
  } catch (e) {
    if (e instanceof ChainError && !e.retryable)
      return settleFailure(deps, ctx, e.message, working);
    if (!(e instanceof LeaseLostError))
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

const formatUnits6 = (v: bigint) => {
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac.length < 2 ? frac.padEnd(2, "0") : frac}` : `${whole}.00`;
};
