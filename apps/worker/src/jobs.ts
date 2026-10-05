import {
  CLAIM_LEASE_MS,
  dueRounds,
  processOverride,
  processSubmission,
  runRound,
  syncPayee,
  type RoundDeps,
} from "@misthos/agent";
import { payouts, rounds, submissions } from "@misthos/db";
import {
  LEGACY_RUN_ROUND_QUEUE,
  OverrideDecisionJob,
  ProcessSubmissionJob,
  QUEUES,
  roundJobKey,
  RunRoundJob,
  SyncPayeeJob,
} from "@misthos/shared";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";

export interface JobOptions {
  concurrency: number;
  retryLimit?: number;
  retryDelaySeconds?: number;
}

type Handler = (job: { data: unknown; retryCount: number; retryLimit: number }) => Promise<void>;

/**
 * Create the queues (idempotent). Shared by the worker process and the queue integration test, so the test exercises
 * the real configuration.
 */
export async function createQueues(boss: PgBoss, opts: JobOptions) {
  const retry = {
    retryLimit: opts.retryLimit ?? 4,
    retryDelay: opts.retryDelaySeconds ?? 15,
    retryBackoff: true,
    expireInSeconds: 300,
  };
  await boss.createQueue(QUEUES.processSubmission, retry);
  await boss.createQueue(QUEUES.overrideDecision, { ...retry, retryLimit: 2 });
  // Chain work retries longer: Circle/RPC hiccups are common and every step is idempotent. One queued job per round
  // (stately, keyed by roundJobKey); the round's lease (runRound) is what stops two runs across processes.
  const roundQueue = { ...retry, retryLimit: 8, expireInSeconds: 900 };
  await boss.createQueue(QUEUES.runRound, { ...roundQueue, policy: "stately" });
  await boss.createQueue(LEGACY_RUN_ROUND_QUEUE, roundQueue);
  await boss.createQueue(QUEUES.syncPayee, { ...retry, retryLimit: 8 });
}

function handlers(deps: RoundDeps, log: Logger): Record<string, Handler> {
  return {
    [QUEUES.processSubmission]: async (job) => {
      const { submissionId } = ProcessSubmissionJob.parse(job.data);
      const finalAttempt = job.retryCount >= job.retryLimit;
      const started = Date.now();
      try {
        const res = await processSubmission(deps, submissionId, { finalAttempt });
        log.info({ submissionId, ...res, ms: Date.now() - started }, "submission processed");
      } catch (e) {
        log.warn(
          { submissionId, attempt: job.retryCount, err: (e as Error).message },
          "submission will retry",
        );
        throw e;
      }
    },
    [QUEUES.overrideDecision]: async (job) => {
      const data = OverrideDecisionJob.parse(job.data);
      const res = await processOverride(deps, data);
      log.info({ submissionId: data.submissionId, ...res }, "override processed");
    },
    [QUEUES.syncPayee]: async (job) => {
      const { contributorId } = SyncPayeeJob.parse(job.data);
      const res = await syncPayee(deps, contributorId);
      log.info({ contributorId, ...res }, "payee synced");
    },
    [QUEUES.runRound]: runRoundHandler,
    [LEGACY_RUN_ROUND_QUEUE]: runRoundHandler,
  };
  async function runRoundHandler(job: Parameters<Handler>[0]) {
    const { roundId, force } = RunRoundJob.parse(job.data);
    const res = await runRound(deps, roundId, { force });
    log.info(
      {
        roundId,
        ...res,
        total: "total" in res ? res.total.toString() : undefined,
        balance: "balance" in res ? res.balance.toString() : undefined,
      },
      "round processed",
    );
  }
}

/** Close rounds whose window ended (programs with a vault). */
export async function scheduleRounds(boss: PgBoss, deps: RoundDeps, log: Logger, now = new Date()) {
  const due = await dueRounds(deps.db, now);
  for (const { id } of due)
    await boss.send(
      QUEUES.runRound,
      { roundId: id, force: false },
      { singletonKey: roundJobKey(id) },
    );
  if (due.length) log.info({ count: due.length }, "enqueued due rounds");
  return due.length;
}

/**
 * Pick up rounds that are past "open" but not finished (F-08): a crashed run, a round waiting for the owner's
 * approval (re-polled until the chain says Approved), a round cancelled on-chain, a job that ran out of retries.
 * runRound reads the chain and database first and every transaction has a deterministic idempotency key, so a
 * repeat run never pays twice. "Nothing to pay" rounds (planned with no payouts) are finished and skipped.
 */
export async function recoverRounds(boss: PgBoss, deps: RoundDeps, log: Logger) {
  const inFlight = await deps.db
    .select({ id: rounds.id })
    .from(rounds)
    .where(
      and(
        inArray(rounds.status, ["closed", "proposed", "approved"]),
        or(
          sql`${rounds.status} <> 'closed'`,
          sql`${rounds.decisionRoot} is null`,
          sql`exists (select 1 from ${payouts} where ${payouts.roundId} = ${rounds.id} and ${payouts.status} in ('pending', 'proposed'))`,
        ),
      ),
    )
    .limit(50);
  let sent = 0;
  for (const { id } of inFlight)
    // One queued job per round (stately queue): a round that already has one isn't queued again.
    if (
      await boss.send(
        QUEUES.runRound,
        { roundId: id, force: false },
        { singletonKey: roundJobKey(id) },
      )
    )
      sent++;
  if (sent) log.info({ count: sent }, "re-enqueued in-flight rounds");
  return inFlight.length;
}

/** Re-enqueue submissions that never got a job or whose worker died mid-claim. Claims make duplicates harmless. */
export async function sweep(boss: PgBoss, deps: RoundDeps, log: Logger, now = Date.now()) {
  const stuck = await deps.db
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      or(
        and(
          eq(submissions.status, "pending"),
          lt(submissions.updatedAt, new Date(now - 2 * 60_000)),
        ),
        and(
          eq(submissions.status, "processing"),
          lt(submissions.updatedAt, new Date(now - CLAIM_LEASE_MS)),
        ),
      ),
    )
    .limit(50);
  for (const { id } of stuck)
    await boss.send(QUEUES.processSubmission, { submissionId: id }, { singletonKey: id });
  if (stuck.length) log.info({ count: stuck.length }, "re-enqueued stuck submissions");
  return stuck.length;
}

export interface DrainResult {
  processed: number;
  /** When the earliest waiting job (a scheduled retry) becomes due, if any. */
  nextDueAt: Date | null;
  /** The oldest job that is due now and still queued after the drain (should be none). */
  oldestQueuedAt: Date | null;
}

/**
 * One pass over the queues: schedule due rounds, recover stuck rounds and submissions, then work every queue until
 * it's empty. Rounds run strictly one at a time (they move money); submissions run up to `concurrency` at once.
 * Returns when nothing more is due, so the caller can close the connection and let the database sleep.
 */
export async function runDrain(
  boss: PgBoss,
  deps: RoundDeps,
  log: Logger,
  opts: JobOptions & { maxJobs?: number; housekeeping?: boolean },
): Promise<DrainResult> {
  if (opts.housekeeping !== false) {
    await scheduleRounds(boss, deps, log);
    await recoverRounds(boss, deps, log);
    await sweep(boss, deps, log);
  }
  const h = handlers(deps, log);
  const order = [
    QUEUES.processSubmission,
    QUEUES.overrideDecision,
    QUEUES.syncPayee,
    QUEUES.runRound,
    LEGACY_RUN_ROUND_QUEUE,
  ];
  let processed = 0;
  const max = opts.maxJobs ?? 500;
  for (let busy = true; busy && processed < max;) {
    busy = false;
    for (const name of order) {
      const batch = await boss.fetch(name, {
        batchSize: name === QUEUES.processSubmission ? opts.concurrency : 1,
        includeMetadata: true,
      });
      if (!batch.length) continue;
      busy = true;
      await Promise.all(
        batch.map(async (job) => {
          try {
            await h[name]!(job);
            await boss.complete(name, job.id);
          } catch (e) {
            await boss.fail(name, job.id, { message: (e as Error).message });
          }
          processed++;
        }),
      );
    }
  }
  const res = await deps.db.execute(sql`
      select
        (extract(epoch from min(start_after) filter (where start_after > now())) * 1000)::float8 as next_due,
        (extract(epoch from min(created_on) filter (where start_after <= now())) * 1000)::float8 as oldest
      from pgboss.job where state in ('created', 'retry')`);
  // node-postgres and PGlite both return { rows }.
  const [row] = (res as unknown as { rows: { next_due: number | null; oldest: number | null }[] })
    .rows;
  return {
    processed,
    nextDueAt: row?.next_due ? new Date(Number(row.next_due)) : null,
    oldestQueuedAt: row?.oldest ? new Date(Number(row.oldest)) : null,
  };
}
