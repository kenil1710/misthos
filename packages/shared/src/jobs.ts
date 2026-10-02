import { z } from "zod";

/** pg-boss queues shared by the web app (producer) and the worker (consumer). */
export const QUEUES = {
  processSubmission: "submission-process",
  overrideDecision: "decision-override",
} as const;

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
