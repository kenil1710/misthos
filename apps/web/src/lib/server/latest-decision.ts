import "server-only";
import { decisions } from "@misthos/db";
import { sql } from "drizzle-orm";

/**
 * True for a submission's current decision only. An override or a re-process supersedes the earlier record, which
 * stays verifiable but must not be shown as the outcome.
 */
export const isLatestDecision = sql`not exists (select 1 from decisions d2 where d2.submission_id = ${decisions.submissionId} and d2.created_at > ${decisions.createdAt})`;
