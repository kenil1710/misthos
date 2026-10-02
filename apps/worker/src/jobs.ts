import {
  CLAIM_LEASE_MS,
  dueRounds,
  processOverride,
  processSubmission,
  runRound,
  syncPayee,
  type RoundDeps,
} from "@misthos/agent";
import { submissions } from "@misthos/db";
import {
  OverrideDecisionJob,
  ProcessSubmissionJob,
  QUEUES,
  RunRoundJob,
  SyncPayeeJob,
} from "@misthos/shared";
import { and, eq, lt, or } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";

export interface JobOptions {
  concurrency: number;
  retryLimit?: number;
  retryDelaySeconds?: number;
  pollingIntervalSeconds?: number;
  sweepIntervalMs?: number;
}

/**
 * Create the queues and register handlers. Shared by the worker process and the queue integration test, so the
 * test exercises the real wiring.
 */
export async function registerJobs(boss: PgBoss, deps: RoundDeps, log: Logger, opts: JobOptions) {
  const retry = {
    retryLimit: opts.retryLimit ?? 4,
    retryDelay: opts.retryDelaySeconds ?? 15,
    retryBackoff: true,
    expireInSeconds: 300,
  };
  await boss.createQueue(QUEUES.processSubmission, retry);
  await boss.createQueue(QUEUES.overrideDecision, { ...retry, retryLimit: 2 });
  // Chain work retries longer: Circle/RPC hiccups are common and every step is idempotent.
  await boss.createQueue(QUEUES.runRound, { ...retry, retryLimit: 8, expireInSeconds: 900 });
  await boss.createQueue(QUEUES.syncPayee, { ...retry, retryLimit: 8 });
  const polling = opts.pollingIntervalSeconds ?? 1;

  await boss.work(
    QUEUES.processSubmission,
    {
      batchSize: 1,
      pollingIntervalSeconds: polling,
      includeMetadata: true,
      localConcurrency: opts.concurrency,
    },
    async ([job]) => {
      const { submissionId } = ProcessSubmissionJob.parse(job!.data);
      const finalAttempt = job!.retryCount >= job!.retryLimit;
      const started = Date.now();
      try {
        const res = await processSubmission(deps, submissionId, { finalAttempt });
        log.info({ submissionId, ...res, ms: Date.now() - started }, "submission processed");
      } catch (e) {
        log.warn(
          { submissionId, attempt: job!.retryCount, err: (e as Error).message },
          "submission will retry",
        );
        throw e;
      }
    },
  );

  await boss.work(
    QUEUES.overrideDecision,
    { batchSize: 1, pollingIntervalSeconds: polling },
    async ([job]) => {
      const data = OverrideDecisionJob.parse(job!.data);
      const res = await processOverride(deps, data);
      log.info({ submissionId: data.submissionId, ...res }, "override processed");
    },
  );

  // One round at a time per worker: rounds move money, so they never run concurrently here.
  await boss.work(
    QUEUES.runRound,
    { batchSize: 1, pollingIntervalSeconds: polling, localConcurrency: 1 },
    async ([job]) => {
      const { roundId, force } = RunRoundJob.parse(job!.data);
      const res = await runRound(deps, roundId, { force });
      log.info(
        { roundId, ...res, total: "total" in res ? res.total.toString() : undefined },
        "round processed",
      );
    },
  );

  await boss.work(
    QUEUES.syncPayee,
    { batchSize: 1, pollingIntervalSeconds: polling, localConcurrency: 1 },
    async ([job]) => {
      const { contributorId } = SyncPayeeJob.parse(job!.data);
      const res = await syncPayee(deps, contributorId);
      log.info({ contributorId, ...res }, "payee synced");
    },
  );

  /** Close rounds whose window ended (programs with a vault). */
  const scheduleRounds = async (now = new Date()) => {
    const due = await dueRounds(deps.db, now);
    for (const { id } of due)
      await boss.send(
        QUEUES.runRound,
        { roundId: id, force: false },
        { singletonKey: `round:${id}` },
      );
    if (due.length) log.info({ count: due.length }, "enqueued due rounds");
    return due.length;
  };

  /** Re-enqueue submissions that never got a job or whose worker died mid-claim. Claims make duplicates harmless. */
  const sweep = async (now = Date.now()) => {
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
  };
  const timer =
    opts.sweepIntervalMs === 0
      ? null
      : setInterval(
          () => void sweep().catch((e) => log.error({ err: (e as Error).message }, "sweep failed")),
          opts.sweepIntervalMs ?? 60_000,
        );

  const roundTimer =
    opts.sweepIntervalMs === 0
      ? null
      : setInterval(
          () =>
            void scheduleRounds().catch((e) =>
              log.error({ err: (e as Error).message }, "round scheduling failed"),
            ),
          opts.sweepIntervalMs ?? 60_000,
        );

  return {
    sweep,
    scheduleRounds,
    stop: () => {
      if (timer) clearInterval(timer);
      if (roundTimer) clearInterval(roundTimer);
    },
  };
}
