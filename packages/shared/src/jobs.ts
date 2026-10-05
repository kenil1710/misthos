import { z } from "zod";

/** pg-boss queues shared by the web app (producer) and the worker (consumer). */
export const QUEUES = {
  processSubmission: "submission-process",
  overrideDecision: "decision-override",
  /**
   * One job per round (N-7): a "stately" queue, so a second send for a round that already has a queued job is
   * dropped. Every sender uses the key `roundJobKey(id)`. ("round-run", the old standard-policy queue, is still
   * drained by the worker so nothing sent during a deploy is lost.)
   */
  runRound: "round-run-once",
  syncPayee: "payee-sync",
} as const;

export const RunRoundJob = z.object({ roundId: z.uuid(), force: z.boolean().default(false) });
export type RunRoundJob = z.infer<typeof RunRoundJob>;

export const SyncPayeeJob = z.object({ contributorId: z.uuid() });
export type SyncPayeeJob = z.infer<typeof SyncPayeeJob>;

export const ProcessSubmissionJob = z.object({ submissionId: z.uuid() });
export type ProcessSubmissionJob = z.infer<typeof ProcessSubmissionJob>;

export const OverrideDecisionJob = z.object({
  submissionId: z.uuid(),
  userId: z.uuid(),
  action: z.enum(["approve", "reject"]),
  /** 6-dec base units as a string; required for approve. */
  amount: z
    .string()
    .regex(/^\d{1,24}$/)
    .optional(),
  reason: z.string().trim().min(10).max(1000),
});
export type OverrideDecisionJob = z.infer<typeof OverrideDecisionJob>;

/** pg-boss schema shared by producer (web) and consumer (worker). */
export const QUEUE_SCHEMA = "pgboss";

/** Web-side producer: sends only. The worker owns the schema, migrations, maintenance and scheduling. */
export const PRODUCER_OPTIONS = {
  schema: QUEUE_SCHEMA,
  supervise: false,
  schedule: false,
  migrate: false,
  createSchema: false,
} as const;

/** The old round queue (standard policy, no dedupe); the worker drains it until it's empty. */
export const LEGACY_RUN_ROUND_QUEUE = "round-run";

/** The single dedupe key for a round's job, whoever sends it (scheduler, recovery, owner close or approval). */
export const roundJobKey = (roundId: string) => `round:${roundId}`;
