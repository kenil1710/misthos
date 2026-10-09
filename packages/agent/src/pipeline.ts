import {
  apiUsage,
  appeals,
  auditEvents,
  contributors,
  decisions,
  fetchedResources,
  programContexts,
  programs,
  rounds,
  submissions,
  type DbLike,
} from "@misthos/db";
import { formatUsdc, hashCanonical, hashText, type OverrideDecisionJob } from "@misthos/shared";
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Hex } from "viem";
import { NEAR_DUPLICATE_HARD, runChecks, TRUSTED_TIME, type PriorMatch } from "./checks";
import { decide, RULE_VERSION, type EngineDecision } from "./engine";
import { explain } from "./explain";
import type { Understander } from "./context";
import { JudgeError, type Judge, type JudgeBrief, type Judgment } from "./judge";
import { signRecord, type AgentSigner, type DecisionRecord } from "./record";
import { fromSigned64, hamming, simhash64, toSigned64 } from "./simhash";
import {
  FetchError,
  type ApiUsageEntry,
  type FetchResult,
  type Flag,
  type Resource,
} from "./types";

export interface Fetchers {
  /** `thread: false` reads only the post itself (payout re-checks); by default the author's thread is read too. */
  x(id: string, opts?: { thread?: boolean }): Promise<FetchResult>;
  githubPr(resourceId: string): Promise<FetchResult>;
  githubCommit(resourceId: string): Promise<FetchResult>;
  article(resourceId: string): Promise<FetchResult>;
}

export interface PipelineDeps {
  db: DbLike;
  fetchers: Fetchers;
  judge: Judge | null;
  /** Drafts "Here's what I understood" from a program's context (null: owners write it themselves). */
  understand?: Understander | null;
  signer: AgentSigner;
  chainId: number;
  now?: () => Date;
}

export type ProcessResult =
  | { status: "skipped"; reason: string }
  | { status: "decided"; action: EngineDecision["action"]; decisionHash: Hex; summary: string };

/** db.execute returns { rows } on node-postgres and PGlite alike; keep the access in one typed place. */
function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] };
  return Array.isArray(r.rows) ? r.rows : (result as T[]);
}

/** How long a claim lasts before another worker may take over a stuck submission. */
export const CLAIM_LEASE_MS = 10 * 60 * 1000;

const STATUS = {
  approve: "approved",
  partial: "partial",
  reject: "rejected",
  escalate: "escalated",
} as const;

async function loadContext(db: DbLike, submissionId: string) {
  const [row] = await db
    .select({
      submission: submissions,
      program: programs,
      contributor: contributors,
      round: rounds,
    })
    .from(submissions)
    .innerJoin(programs, eq(programs.id, submissions.programId))
    .innerJoin(contributors, eq(contributors.id, submissions.contributorId))
    .innerJoin(rounds, eq(rounds.id, submissions.roundId))
    .where(eq(submissions.id, submissionId))
    .limit(1);
  return row ?? null;
}

async function logUsage(db: DbLike, programId: string, entries: ApiUsageEntry[]) {
  if (!entries.length) return;
  await db.insert(apiUsage).values(
    entries.map((u) => ({
      provider: u.provider,
      endpoint: u.endpoint,
      units: u.units,
      estCostUsd: u.estCostUsd.toFixed(6),
      programId,
      metaJson: u.meta ?? {},
    })),
  );
}

/**
 * Cached resource, or fetch once and cache. Deleted/missing resources are never cached. X posts cached before
 * threads were read (no `x.thread`) are fetched again; `refresh` always fetches and replaces the cached copy.
 */
async function getResource(
  deps: PipelineDeps,
  programId: string,
  sourceType: Resource["sourceType"],
  resourceId: string,
  opts: { refresh?: boolean } = {},
): Promise<
  { resource: Resource; contentHash: Hex; simhash: bigint | null } | { notFound: string }
> {
  const [cached] = await deps.db
    .select()
    .from(fetchedResources)
    .where(
      and(eq(fetchedResources.sourceType, sourceType), eq(fetchedResources.resourceId, resourceId)),
    )
    .limit(1);
  const stale =
    opts.refresh ||
    (sourceType === "x_post" && !(cached?.payloadJson as Resource | undefined)?.x?.thread);
  if (cached && !stale) {
    return {
      resource: cached.payloadJson as Resource,
      contentHash: cached.contentHash as Hex,
      simhash: cached.simhash === null ? null : fromSigned64(cached.simhash),
    };
  }
  const fetcher = {
    x_post: deps.fetchers.x,
    github_pr: deps.fetchers.githubPr,
    github_commit: deps.fetchers.githubCommit,
    article: deps.fetchers.article,
  }[sourceType];
  const { outcome, usage } = await fetcher(resourceId);
  await logUsage(deps.db, programId, usage);
  if (outcome.status === "not_found") return { notFound: outcome.detail };
  const resource = outcome.resource;
  const contentHash = hashText(resource.text);
  const simhash = simhash64(resource.text);
  await deps.db
    .insert(fetchedResources)
    .values({
      sourceType,
      resourceId,
      payloadJson: resource,
      contentText: resource.text,
      contentHash,
      simhash: simhash === null ? null : toSigned64(simhash),
    })
    .onConflictDoUpdate({
      target: [fetchedResources.sourceType, fetchedResources.resourceId],
      set: {
        payloadJson: resource,
        contentText: resource.text,
        contentHash,
        simhash: simhash === null ? null : toSigned64(simhash),
        fetchedAt: new Date(),
      },
    });
  return { resource, contentHash, simhash };
}

/** Decided submissions that can be re-processed: anything not yet planned into a payout or paid. */
const REPROCESSABLE = new Set(["approved", "partial", "rejected", "escalated"]);

/**
 * Score one submission end to end and persist a signed decision. Idempotent: anything already decided is skipped.
 * Retryable upstream errors are rethrown (the queue retries); on the final attempt they become an escalation.
 *
 * `reprocess` runs a decided submission again (fresh fetch, current rules) and records a new signed agent decision
 * that supersedes the latest one, with the reason, auditing both. Not allowed once the item is in a payout.
 */
export async function processSubmission(
  deps: PipelineDeps,
  submissionId: string,
  opts: { finalAttempt?: boolean; reprocess?: { reason: string; actor: string } } = {},
): Promise<ProcessResult> {
  const db = deps.db;
  const now = deps.now ?? (() => new Date());
  const ctx = await loadContext(db, submissionId);
  if (!ctx) return { status: "skipped", reason: "not_found" };
  const { submission: sub, program, contributor, round } = ctx;
  const reprocess = opts.reprocess;
  let previous: typeof decisions.$inferSelect | undefined;
  if (reprocess) {
    if (!REPROCESSABLE.has(sub.status) || sub.payoutId)
      return {
        status: "skipped",
        reason: `not_reprocessable_${sub.payoutId ? "in_payout" : sub.status}`,
      };
    [previous] = await db
      .select()
      .from(decisions)
      .where(eq(decisions.submissionId, sub.id))
      .orderBy(desc(decisions.createdAt))
      .limit(1);
    if (!previous) return { status: "skipped", reason: "no_previous_decision" };
  } else if (sub.status !== "pending" && sub.status !== "processing")
    return { status: "skipped", reason: `already_${sub.status}` };
  // Atomic claim: only one worker processes a submission. A "processing" row older than the lease is a crashed
  // worker's and may be reclaimed. A re-process claims the row only in the decided state it was read in.
  const claimed = await db
    .update(submissions)
    .set({ status: "processing" })
    .where(
      and(
        eq(submissions.id, sub.id),
        reprocess
          ? and(eq(submissions.status, sub.status), isNull(submissions.payoutId))
          : or(
              eq(submissions.status, "pending"),
              and(
                eq(submissions.status, "processing"),
                lt(submissions.updatedAt, new Date(now().getTime() - CLAIM_LEASE_MS)),
              ),
            ),
      ),
    )
    .returning({ id: submissions.id });
  if (!claimed.length) return { status: "skipped", reason: "in_progress" };
  // Hand a retryable failure back: queued work goes back to pending, a re-process to its previous decided state.
  const release = (lastError: string) =>
    db
      .update(submissions)
      .set({ status: reprocess ? sub.status : "pending", lastError })
      .where(eq(submissions.id, sub.id));

  // ── Fetch ────────────────────────────────────────────────────────────
  let resource: Resource | null = null;
  let contentHash: Hex | null = null;
  let simhash: bigint | null = null;
  let notFound: string | undefined;
  let fetchError: string | undefined;
  try {
    const got = await getResource(deps, program.id, sub.sourceType, sub.resourceId, {
      refresh: !!reprocess,
    });
    if ("notFound" in got) notFound = got.notFound;
    else ({ resource, contentHash, simhash } = got);
  } catch (e) {
    const fe = e instanceof FetchError ? e : new FetchError("Unexpected fetch failure", true);
    if (fe.retryable && !opts.finalAttempt) {
      await release(fe.message);
      throw fe;
    }
    fetchError = fe.message;
  }

  // ── Duplicates and similarity (earlier submissions; the original is whoever published first) ──
  const passedOwnership = sql`exists (
    select 1 from decisions d
    where d.submission_id = ${submissions.id}
      and not exists (select 1 from decisions d2 where d2.submission_id = d.submission_id and d2.created_at > d.created_at)
      and not (d.flags_json @> '[{"code":"OWNERSHIP_MISMATCH"}]'::jsonb)
      and not (d.flags_json @> '[{"code":"OWNERSHIP_UNVERIFIED"}]'::jsonb)
  )`;
  const earlier = or(
    lt(submissions.createdAt, sub.createdAt),
    and(eq(submissions.createdAt, sub.createdAt), lt(submissions.id, sub.id)),
  );
  const sameResource = (
    await db
      .select({
        submissionId: submissions.id,
        xHandle: contributors.xHandle,
        submittedAt: submissions.createdAt,
      })
      .from(submissions)
      .innerJoin(contributors, eq(contributors.id, submissions.contributorId))
      .where(
        and(
          eq(submissions.programId, program.id),
          eq(submissions.sourceType, sub.sourceType),
          eq(submissions.resourceId, sub.resourceId),
          ne(submissions.contributorId, contributor.id),
          ne(submissions.id, sub.id),
          earlier,
          // Only a prior whose ownership was positively verified counts (F-03, N-3): someone who submitted another
          // person's work first doesn't make the real author a duplicate.
          passedOwnership,
        ),
      )
  ).map((r) => ({ ...r }));

  let similar: PriorMatch[] = [];
  let priorCount = 0;
  if (resource) {
    type SimilarRow = {
      id: string;
      contributor_id: string;
      x_handle: string;
      url: string;
      created_at: string | Date;
      simhash: string | null;
      sim: number;
      content_at: string | null;
      source_type: Resource["sourceType"];
    };
    const rows = rowsOf<SimilarRow>(
      await db.execute(sql`
      select s.id, s.contributor_id, c.x_handle, s.url, s.created_at, fr.simhash::text as simhash,
             similarity(fr.content_text, ${resource.text}) as sim,
             -- An article's date comes from its own page: never used to decide which piece is the original (N-4).
             case when s.source_type = 'article' then null else fr.payload_json->>'timestamp' end as content_at,
             s.source_type
      from submissions s
      join fetched_resources fr on fr.source_type = s.source_type and fr.resource_id = s.resource_id
      join contributors c on c.id = s.contributor_id
      where s.program_id = ${program.id}
        and s.id <> ${sub.id}
        and not (s.source_type = ${sub.sourceType} and s.resource_id = ${sub.resourceId})
        and (s.created_at < ${sub.createdAt} or (s.created_at = ${sub.createdAt} and s.id < ${sub.id}))
        and not exists (
          select 1 from decisions d where d.submission_id = s.id
            and not exists (select 1 from decisions d2 where d2.submission_id = d.submission_id and d2.created_at > d.created_at)
            and d.flags_json @> '[{"code":"OWNERSHIP_MISMATCH"}]'::jsonb
        )
      order by sim desc
      limit 5`),
    );
    similar = rows.map((r) => ({
      submissionId: r.id,
      contributorId: r.contributor_id,
      xHandle: r.x_handle,
      url: r.url,
      submittedAt: new Date(r.created_at),
      similarity: Number(r.sim),
      contentAt:
        r.content_at && !Number.isNaN(Date.parse(r.content_at)) ? new Date(r.content_at) : null,
      sourceType: r.source_type,
      hamming:
        simhash !== null && r.simhash !== null
          ? hamming(simhash, fromSigned64(BigInt(r.simhash)))
          : null,
    }));
    const counted = rowsOf<{ n: number }>(
      await db.execute(sql`
      select count(*)::int as n from submissions s
      join fetched_resources fr on fr.source_type = s.source_type and fr.resource_id = s.resource_id
      where s.program_id = ${program.id} and s.id <> ${sub.id}
        and (s.created_at < ${sub.createdAt} or (s.created_at = ${sub.createdAt} and s.id < ${sub.id}))`),
    );
    priorCount = Number(counted[0]?.n ?? 0);
  }

  // ── The program's context for the agent (trusted; its version and hash go into the record) ──
  const brief = await programBrief(db, program);

  // ── Deterministic checks ─────────────────────────────────────────────
  const limits = program.limitsJson;
  const categories = program.rubricJson.categories;
  let flags: Flag[];
  if (fetchError) {
    flags = [
      {
        code: "FETCH_FAILED",
        severity: "soft",
        message: `The content couldn't be fetched: ${fetchError}`,
        evidence: { error: fetchError },
      },
    ];
  } else {
    flags = runChecks({
      sourceType: sub.sourceType,
      resource,
      notFoundDetail: notFound,
      contributor: {
        id: contributor.id,
        xUserId: contributor.xUserId,
        xHandle: contributor.xHandle,
        githubLogin: contributor.githubLogin,
        githubUserId: contributor.githubUserId,
        walletChangedAt: contributor.walletChangedAt,
      },
      round: { startsAt: round.startsAt, endsAt: round.endsAt },
      program: {
        minAccountAgeDays: program.minAccountAgeDays,
        payeeCooldownSeconds: limits.payeeCooldownSeconds,
        categories,
        minXFollowers: program.minXFollowers,
        belowMinimum: program.belowMinimum,
        mustInclude: brief?.judge.mustInclude ?? [],
      },
      sameResource,
      similar,
      submittedAt: sub.createdAt,
    });
  }

  // ── Judgment (skipped when a rejecting flag already decides the outcome) ──
  const rejectAlready = flags.some(
    (f) => f.severity === "hard" && f.code !== "PROMPT_INJECTION_ATTEMPT",
  );
  let judgment: Judgment | null = null;
  let judgeError: string | undefined = fetchError;
  if (resource && !rejectAlready && deps.judge) {
    try {
      judgment = await deps.judge({
        programName: program.name,
        generalRules: program.rubricJson.generalRules,
        categories,
        ratePerPointUsdc: formatUsdc(program.ratePerPoint, { withSymbol: false }),
        resource,
        flags,
        contributorHandle: contributor.xHandle,
        brief: brief?.judge ?? null,
      });
      await logUsage(db, program.id, [judgment.usage]);
    } catch (e) {
      const je = e instanceof JudgeError ? e : new JudgeError("Judgment failed.", false);
      if (je.retryable && !opts.finalAttempt) {
        await release(je.message);
        throw je;
      }
      judgeError = je.message;
    }
  } else if (resource && !rejectAlready && !deps.judge) {
    judgeError = "the model isn't configured";
  }

  // ── Decision ─────────────────────────────────────────────────────────
  const decision = decide({
    flags,
    judgment: judgment?.output ?? null,
    judgeError,
    categories,
    resource,
    ratePerPoint: program.ratePerPoint,
    autoApproveConfidence: program.autoApproveConfidence,
    maxPerPayout: BigInt(limits.maxPerPayout),
    maxAutoApproveItem: BigInt(limits.maxAutoApproveItem),
  });
  const allFlags = [...flags, ...decision.addedFlags];
  const summary = explain({
    decision,
    flags,
    judgment: judgment?.output ?? null,
    categories,
    resource,
    priorCount,
    judgeError,
  });

  const inputHash = hashCanonical({
    submission: { url: sub.url, sourceType: sub.sourceType, resourceId: sub.resourceId },
    contributor: {
      xUserId: contributor.xUserId,
      githubLogin: contributor.githubLogin,
      wallet: contributor.walletAddress,
    },
    round: { startsAt: round.startsAt, endsAt: round.endsAt },
    program: {
      rubric: program.rubricJson,
      ratePerPoint: program.ratePerPoint,
      limits,
      autoApproveConfidence: program.autoApproveConfidence,
      minAccountAgeDays: program.minAccountAgeDays,
      minXFollowers: program.minXFollowers,
      // Only when it differs from the default, so earlier decisions keep their input hash.
      ...(program.belowMinimum !== "review" ? { belowMinimum: program.belowMinimum } : {}),
      context: brief?.hash ?? null,
    },
  });

  const signed = await signRecord(
    {
      schema: "misthos.decision/v1",
      chainId: deps.chainId,
      program: { id: program.id, slug: program.slug },
      submission: {
        id: sub.id,
        url: sub.url,
        sourceType: sub.sourceType,
        resourceId: sub.resourceId,
        submittedAt: sub.createdAt.toISOString(),
      },
      contributor: {
        id: contributor.id,
        xUserId: contributor.xUserId,
        xHandle: contributor.xHandle,
        githubLogin: contributor.githubLogin,
        wallet: contributor.walletAddress,
      },
      round: {
        id: round.id,
        number: round.number,
        startsAt: round.startsAt.toISOString(),
        endsAt: round.endsAt.toISOString(),
      },
      inputHash,
      contentHash,
      context: brief ? { version: brief.version, hash: brief.hash } : null,
      flags: allFlags,
      judgment: judgment
        ? { model: judgment.model, promptVersion: judgment.promptVersion, output: judgment.output }
        : null,
      ruleVersion: RULE_VERSION,
      rule: decision.rule,
      decision: {
        action: decision.action,
        categoryKey: decision.categoryKey,
        points: decision.points,
        amount: decision.amount.toString(),
        auto: decision.auto,
      },
      decidedBy:
        reprocess && previous
          ? { type: "agent", supersedes: previous.decisionHash as Hex, reason: reprocess.reason }
          : { type: "agent" },
      summary,
      decidedAt: now().toISOString(),
    },
    deps.signer,
  );

  await persist(db, {
    submissionId: sub.id,
    programId: program.id,
    status: STATUS[decision.action],
    amount: decision.action === "reject" ? 0n : decision.amount,
    signed,
    llmOutput: judgment?.output ?? null,
    model: judgment?.model ?? null,
    promptVersion: judgment?.promptVersion ?? null,
    decidedBy: "agent",
    decidedByUserId: null,
    overrideReason: null,
    auditAction: reprocess ? "decision.reprocessed" : "decision.recorded",
    supersedes:
      reprocess && previous
        ? {
            decisionId: previous.id,
            decisionHash: previous.decisionHash,
            actor: reprocess.actor,
            reason: reprocess.reason,
          }
        : undefined,
    now: now(),
  });
  // This submission is the original of a near-identical post someone else submitted earlier but published later
  // (F-03): that later copy is probably the duplicate. The agent never rejects or supersedes an earlier decision on
  // its own: the copy is held for a person to review. Only platform dates count, so articles never trigger this.
  if (
    resource?.timestamp &&
    TRUSTED_TIME.has(resource.sourceType) &&
    !Number.isNaN(Date.parse(resource.timestamp))
  ) {
    const mine = Date.parse(resource.timestamp);
    for (const m of similar) {
      const sim = Math.max(m.similarity, m.hamming !== null ? 1 - m.hamming / 64 : 0);
      if (
        m.contributorId !== contributor.id &&
        TRUSTED_TIME.has(m.sourceType ?? "x_post") &&
        sim >= NEAR_DUPLICATE_HARD &&
        m.contentAt &&
        m.contentAt.getTime() > mine
      )
        await holdCopyForReview(deps, m.submissionId, {
          url: sub.url,
          xHandle: contributor.xHandle,
          publishedAt: new Date(mine),
          similarity: sim,
        });
    }
  }
  return { status: "decided", action: decision.action, decisionHash: signed.decisionHash, summary };
}

async function persist(
  db: DbLike,
  p: {
    submissionId: string;
    programId: string;
    status: (typeof STATUS)[keyof typeof STATUS];
    amount: bigint;
    signed: Awaited<ReturnType<typeof signRecord>>;
    llmOutput: unknown;
    model: string | null;
    promptVersion: string | null;
    decidedBy: "agent" | "human";
    decidedByUserId: string | null;
    overrideReason: string | null;
    auditAction: string;
    /** For a re-process: the decision being replaced. Audited as `decision.superseded` next to the new decision. */
    supersedes?: { decisionId: string; decisionHash: string; actor: string; reason: string };
    /** Overrides: write only while the item isn't in a payout (a planned round pays it regardless). */
    requireNoPayout?: boolean;
    now: Date;
  },
) {
  const r = p.signed.record;
  await db.transaction(async (tx) => {
    const [d] = await tx
      .insert(decisions)
      .values({
        submissionId: p.submissionId,
        flagsJson: r.flags,
        llmOutputJson: p.llmOutput,
        action: r.decision.action as "approve" | "partial" | "reject" | "escalate",
        amount: BigInt(r.decision.amount),
        categoryKey: r.decision.categoryKey,
        points: r.decision.points,
        summary: r.summary,
        decisionJson: p.signed.decisionJson,
        decisionHash: p.signed.decisionHash,
        signature: p.signed.signature,
        signerAddress: r.signer,
        model: p.model,
        promptVersion: p.promptVersion,
        ruleVersion: r.ruleVersion,
        decidedBy: p.decidedBy,
        decidedByUserId: p.decidedByUserId,
        overrideReason: p.overrideReason,
      })
      .returning({ id: decisions.id });
    const updated = await tx
      .update(submissions)
      .set({
        status: p.status,
        amount: p.status === "rejected" ? 0n : p.amount,
        processedAt: p.now,
        lastError: null,
      })
      .where(
        and(
          eq(submissions.id, p.submissionId),
          p.requireNoPayout ? isNull(submissions.payoutId) : undefined,
        ),
      )
      .returning({ id: submissions.id });
    // Rolls back the decision insert too: the round planned this item between our read and this write.
    if (!updated.length) throw new InPayoutError();
    await tx.insert(auditEvents).values({
      programId: p.programId,
      actor: p.decidedBy === "agent" ? "agent" : `user:${p.decidedByUserId}`,
      action: p.auditAction,
      entity: "submission",
      entityId: p.submissionId,
      dataJson: {
        decisionId: d!.id,
        decisionHash: p.signed.decisionHash,
        action: r.decision.action,
        amount: r.decision.amount,
        rule: r.rule,
        flags: r.flags.map((f) => f.code),
        ...(p.supersedes
          ? { supersedes: p.supersedes.decisionHash, reason: p.supersedes.reason }
          : {}),
      },
    });
    if (p.supersedes) {
      await tx.insert(auditEvents).values({
        programId: p.programId,
        actor: p.supersedes.actor,
        action: "decision.superseded",
        entity: "decision",
        entityId: p.supersedes.decisionId,
        dataJson: {
          submissionId: p.submissionId,
          decisionHash: p.supersedes.decisionHash,
          supersededBy: p.signed.decisionHash,
          supersededById: d!.id,
          reason: p.supersedes.reason,
        },
      });
    }
  });
}

export type OverrideResult =
  | { ok: true; decisionHash: Hex }
  | {
      ok: false;
      error: "not_found" | "not_decided" | "invalid_amount" | "not_member" | "in_payout";
    };

/** The item was planned into a payout round, which pays it whatever the database says next. */
class InPayoutError extends Error {}

/**
 * A reviewer's decision. Recorded as a new signed record (decided_by = human) that supersedes the agent's,
 * carrying the reviewer's written reason. The agent key signs as notary; authority comes from program membership.
 */
export async function processOverride(
  deps: PipelineDeps,
  job: OverrideDecisionJob,
): Promise<OverrideResult> {
  const db = deps.db;
  const now = deps.now ?? (() => new Date());
  const ctx = await loadContext(db, job.submissionId);
  if (!ctx) return { ok: false, error: "not_found" };
  const { submission: sub, program, contributor, round } = ctx;
  const memberRows = rowsOf<{ role: string }>(
    await db.execute(
      sql`select role from program_members where program_id = ${program.id} and user_id = ${job.userId} limit 1`,
    ),
  );
  if (!memberRows.length) return { ok: false, error: "not_member" };

  const [prev] = await db
    .select()
    .from(decisions)
    .where(eq(decisions.submissionId, sub.id))
    .orderBy(desc(decisions.createdAt))
    .limit(1);
  if (!prev || sub.status === "pending" || sub.status === "processing" || sub.status === "paid")
    return { ok: false, error: "not_decided" };
  // Once planned into a round, the vault pays it on execution: a database-only override would be a lie. Stopping it
  // takes the owner's on-chain controls (cancel the round, or pause the vault).
  if (sub.payoutId) return { ok: false, error: "in_payout" };

  const limits = program.limitsJson;
  const amount = job.action === "approve" ? BigInt(job.amount ?? prev.amount.toString()) : 0n;
  if (job.action === "approve" && (amount <= 0n || amount > BigInt(limits.maxPerPayout)))
    return { ok: false, error: "invalid_amount" };

  const prevRecord = JSON.parse(prev.decisionJson) as DecisionRecord;
  const verb =
    job.action === "approve"
      ? `Approved by a reviewer · ${formatUsdc(amount)}.`
      : "Rejected by a reviewer.";
  const summary = `${verb} Reason: ${job.reason}`;
  const signed = await signRecord(
    {
      ...prevRecord,
      contributor: { ...prevRecord.contributor, wallet: contributor.walletAddress },
      round: {
        id: round.id,
        number: round.number,
        startsAt: round.startsAt.toISOString(),
        endsAt: round.endsAt.toISOString(),
      },
      rule: "HUMAN_OVERRIDE",
      decision: {
        action: job.action,
        categoryKey: prev.categoryKey,
        points: prev.points,
        amount: amount.toString(),
        auto: false,
      },
      decidedBy: {
        type: "human",
        userId: job.userId,
        reason: job.reason,
        supersedes: prev.decisionHash as Hex,
      },
      summary,
      decidedAt: now().toISOString(),
    },
    deps.signer,
  );
  try {
    await persist(db, {
      submissionId: sub.id,
      programId: program.id,
      status: job.action === "approve" ? "approved" : "rejected",
      amount,
      signed,
      llmOutput: prev.llmOutputJson,
      model: prev.model,
      promptVersion: prev.promptVersion,
      decidedBy: "human",
      decidedByUserId: job.userId,
      overrideReason: job.reason,
      auditAction: "decision.overridden",
      requireNoPayout: true,
      now: now(),
    });
  } catch (e) {
    if (e instanceof InPayoutError) return { ok: false, error: "in_payout" };
    throw e;
  }
  // A contributor's "second look" is answered by this signed decision.
  const answered = await db
    .update(appeals)
    .set({ resolvedAt: now(), resolutionHash: signed.decisionHash })
    .where(and(eq(appeals.submissionId, sub.id), isNull(appeals.resolvedAt)))
    .returning({ id: appeals.id });
  if (answered.length)
    await db.insert(auditEvents).values({
      programId: program.id,
      actor: `user:${job.userId}`,
      action: "appeal.resolved",
      entity: "submission",
      entityId: sub.id,
      dataJson: { decisionHash: signed.decisionHash, action: job.action },
    });
  return { ok: true, decisionHash: signed.decisionHash };
}

/**
 * Re-check at payout time found an approved item no longer valid (deleted, or no longer owned). Records a new signed
 * agent decision that supersedes the approval, so the audit trail shows exactly why it wasn't paid.
 */
export async function rejectAtPayout(
  deps: PipelineDeps,
  submissionId: string,
  flag: Flag,
): Promise<Hex | null> {
  const db = deps.db;
  const now = deps.now ?? (() => new Date());
  const ctx = await loadContext(db, submissionId);
  if (!ctx) return null;
  const { submission: sub, program, contributor, round } = ctx;
  const [prev] = await db
    .select()
    .from(decisions)
    .where(eq(decisions.submissionId, sub.id))
    .orderBy(desc(decisions.createdAt))
    .limit(1);
  if (!prev) return null;
  const prevRecord = JSON.parse(prev.decisionJson) as DecisionRecord;
  const summary = `Rejected at payout. ${flag.message} Approved work is re-checked before every payout.`;
  const signed = await signRecord(
    {
      ...prevRecord,
      contributor: { ...prevRecord.contributor, wallet: contributor.walletAddress },
      round: {
        id: round.id,
        number: round.number,
        startsAt: round.startsAt.toISOString(),
        endsAt: round.endsAt.toISOString(),
      },
      flags: [...prevRecord.flags, flag],
      ruleVersion: RULE_VERSION,
      rule: "R0_PAYOUT_RECHECK",
      decision: {
        action: "reject",
        categoryKey: prev.categoryKey,
        points: prev.points,
        amount: "0",
        auto: true,
      },
      decidedBy: { type: "agent" },
      summary,
      decidedAt: now().toISOString(),
    },
    deps.signer,
  );
  await persist(db, {
    submissionId: sub.id,
    programId: program.id,
    status: "rejected",
    amount: 0n,
    signed,
    llmOutput: prev.llmOutputJson,
    model: prev.model,
    promptVersion: prev.promptVersion,
    decidedBy: "agent",
    decidedByUserId: null,
    overrideReason: null,
    auditAction: "decision.payout_recheck_failed",
    now: now(),
  });
  return signed.decisionHash;
}

/**
 * A later copy of someone's earlier-published work (F-03). The agent never rejects or supersedes a decision already
 * made: an approved copy is held for a person to review (it isn't paid meanwhile), and the owner is told. If it's
 * already in a payout or paid, the owner is told instead. Nothing is signed here; the reviewer's decision is.
 */
export async function holdCopyForReview(
  deps: PipelineDeps,
  copySubmissionId: string,
  original: { url: string; xHandle: string; publishedAt: Date; similarity: number },
): Promise<"held" | "noted" | null> {
  const db = deps.db;
  const [sub] = await db.select().from(submissions).where(eq(submissions.id, copySubmissionId));
  if (!sub) return null;
  const [prev] = await db
    .select()
    .from(decisions)
    .where(eq(decisions.submissionId, sub.id))
    .orderBy(desc(decisions.createdAt))
    .limit(1);
  if (!prev || prev.action === "reject") return null;
  const pct = Math.round(original.similarity * 100);
  const data = {
    original: original.url,
    originalBy: original.xHandle,
    originalPublishedAt: original.publishedAt.toISOString(),
    similarity: pct,
    status: sub.status,
  };
  const note = (action: string) =>
    db.insert(auditEvents).values({
      programId: sub.programId,
      actor: "agent",
      action,
      entity: "submission",
      entityId: sub.id,
      dataJson: data,
    });
  if (
    sub.payoutId ||
    sub.status === "paid" ||
    sub.status === "pending" ||
    sub.status === "processing"
  ) {
    await note("copy.detected_too_late");
    return "noted";
  }
  if (sub.status === "approved" || sub.status === "partial") {
    // Hold it: no longer payable until a person decides. Conditional, so a planned payout is never disturbed.
    const held = await db
      .update(submissions)
      .set({
        status: "escalated",
        lastError: `Held for review: ${pct}% identical to a post by @${original.xHandle} that was published earlier (${original.url}).`,
      })
      .where(
        and(
          eq(submissions.id, sub.id),
          inArray(submissions.status, ["approved", "partial"]),
          isNull(submissions.payoutId),
        ),
      )
      .returning({ id: submissions.id });
    if (!held.length) {
      await note("copy.detected_too_late");
      return "noted";
    }
    await note("copy.held_for_review");
    return "held";
  }
  await note("copy.flagged_for_review");
  return "noted";
}

export function fetcherFor(fetchers: Fetchers, sourceType: Resource["sourceType"]) {
  return {
    x_post: fetchers.x,
    github_pr: fetchers.githubPr,
    github_commit: fetchers.githubCommit,
    article: fetchers.article,
  }[sourceType];
}

/** The program's current saved context, as the judge and checks use it. Null before the owner adds one. */
export async function programBrief(
  db: DbLike,
  program: { id: string; contextVersion: number | null },
): Promise<{ version: number; hash: Hex; judge: JudgeBrief } | null> {
  if (program.contextVersion === null) return null;
  const [c] = await db
    .select()
    .from(programContexts)
    .where(
      and(
        eq(programContexts.programId, program.id),
        eq(programContexts.version, program.contextVersion),
      ),
    )
    .limit(1);
  if (!c?.contextHash) return null;
  const u = c.understandingJson;
  return {
    version: program.contextVersion,
    hash: c.contextHash as Hex,
    judge: {
      about: c.about,
      summary: u?.summary ?? null,
      keyFacts: u?.keyFacts ?? [],
      onTopic: u?.onTopic ?? [],
      offTopic: u?.offTopic ?? [],
      mustInclude: c.mustIncludeJson,
    },
  };
}
