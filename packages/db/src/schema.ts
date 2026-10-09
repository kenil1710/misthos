import type { Rubric, StoredLimits } from "@misthos/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Misthos data model (PROMPT.md §7, reduced scope). Money columns are bigint 6-decimal USDC base units.
 * Addresses are stored lowercase. `audit_events` is append-only, enforced by a trigger (see migrations).
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const usdc = (name: string) => bigint(name, { mode: "bigint" });

// ─── Enums ──────────────────────────────────────────────────────────────────

export const programStatus = pgEnum("program_status", ["draft", "active", "paused", "archived"]);
export const memberRole = pgEnum("member_role", ["owner", "reviewer"]);
export const contributorStatus = pgEnum("contributor_status", ["active", "suspended", "removed"]);
export const roundStatus = pgEnum("round_status", [
  "open",
  "closed",
  "proposed",
  "approved",
  "executed",
  "failed",
]);
export const sourceType = pgEnum("source_type", [
  "x_post",
  "github_pr",
  "github_commit",
  "article",
]);
export const submissionStatus = pgEnum("submission_status", [
  "pending",
  "processing",
  "approved",
  "partial",
  "rejected",
  "escalated",
  "paid",
]);
export const decisionAction = pgEnum("decision_action", [
  "approve",
  "partial",
  "reject",
  "escalate",
]);
export const decidedBy = pgEnum("decided_by", ["agent", "human"]);
export const payoutStatus = pgEnum("payout_status", ["pending", "proposed", "executed", "failed"]);
export const noncePurpose = pgEnum("nonce_purpose", ["siwe", "wallet_link"]);
/** What happens to X accounts below a program's minimum followers or account age. */
export const belowMinimumPolicy = pgEnum("below_minimum_policy", ["review", "reject", "block"]);

// ─── Identity ───────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: id(),
  /** Set when the user signs in with a wallet (owners/reviewers). */
  walletAddress: text("wallet_address").unique(),
  /** Set when the user signs in with X (contributors). */
  xUserId: text("x_user_id").unique(),
  xHandle: text("x_handle"),
  xCreatedAt: timestamp("x_created_at", { withTimezone: true }),
  /** Follower count from the last X sign-in (shown to the contributor against a program's minimum). */
  xFollowers: integer("x_followers"),
  /** Verified through GitHub OAuth (never typed): the numeric id is what ownership checks compare. */
  githubUserId: text("github_user_id").unique(),
  githubLogin: text("github_login"),
  githubVerifiedAt: timestamp("github_verified_at", { withTimezone: true }),
  name: text("name"),
  email: text("email"),
  isFounder: boolean("is_founder").notNull().default(false),
  ...timestamps,
});

/** Single-use nonces for SIWE sign-in and wallet-link signatures. */
export const authNonces = pgTable(
  "auth_nonces",
  {
    nonce: text("nonce").primaryKey(),
    purpose: noncePurpose("purpose").notNull(),
    /** For wallet_link: the contributor's user id the nonce was issued to. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_nonces_expires_idx").on(t.expiresAt)],
);

// ─── Programs ───────────────────────────────────────────────────────────────

export const programs = pgTable(
  "programs",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    logoUrl: text("logo_url"),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    /** keccak256 of the program id, used as the vault's programId. Set at vault deploy. */
    programIdBytes32: text("program_id_bytes32"),
    vaultAddress: text("vault_address"),
    chain: text("chain").notNull(),
    rubricJson: jsonb("rubric_json").$type<Rubric>().notNull(),
    ratePerPoint: usdc("rate_per_point").notNull(),
    limitsJson: jsonb("limits_json").$type<StoredLimits>().notNull(),
    autoApproveConfidence: real("auto_approve_confidence").notNull(),
    minAccountAgeDays: integer("min_account_age_days").notNull().default(0),
    /** X posts from accounts with fewer followers go to review (0 = no minimum). */
    minXFollowers: integer("min_x_followers").notNull().default(0),
    /**
     * Accounts below minXFollowers or minAccountAgeDays: "review" (the owner decides), "reject" (rejected
     * automatically) or "block" (can't join).
     */
    belowMinimum: belowMinimumPolicy("below_minimum").notNull().default("review"),
    /** Submissions a contributor may make per round; more are refused before any fetch or model call. */
    maxSubmissionsPerRound: integer("max_submissions_per_round").notNull().default(5),
    /** The current version of the agent's context (program_contexts.version); null before the owner adds one. */
    contextVersion: integer("context_version"),
    roundLengthDays: integer("round_length_days").notNull(),
    firstRoundStartsAt: timestamp("first_round_starts_at", { withTimezone: true }).notNull(),
    status: programStatus("status").notNull().default("draft"),
    /** Demo programs are excluded from every public metric. */
    isDemo: boolean("is_demo").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("programs_owner_idx").on(t.ownerUserId)],
);

/** What the agent's understanding of a program says (owner-reviewed): see packages/shared/src/context.ts. */
export interface ContextUnderstanding {
  summary: string;
  keyFacts: string[];
  onTopic: string[];
  offTopic: string[];
}
export interface ContextSource {
  url: string;
  ok: boolean;
  title?: string | null;
  /** Why it wasn't used (unreachable, not a page, or it contained instructions for the agent). */
  note?: string | null;
}

/**
 * The program's brief for the agent, versioned. A row starts as a read request (`status` reading → ready/failed,
 * no version) from the wizard or Settings; saving it gives it the program and the next version. Decisions record
 * the version and hash they were judged against.
 */
export const programContexts = pgTable(
  "program_contexts",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    programId: uuid("program_id").references(() => programs.id, { onDelete: "cascade" }),
    version: integer("version"),
    about: text("about").notNull(),
    linksJson: jsonb("links_json").$type<string[]>().notNull().default([]),
    mustIncludeJson: jsonb("must_include_json").$type<string[]>().notNull().default([]),
    status: text("status").$type<"reading" | "ready" | "failed">().notNull().default("reading"),
    understandingJson: jsonb("understanding_json").$type<ContextUnderstanding>(),
    sourcesJson: jsonb("sources_json").$type<ContextSource[]>().notNull().default([]),
    /** keccak256 of the canonical saved context: what a decision commits to. */
    contextHash: text("context_hash"),
    /** keccak256 of the read inputs: an identical read is answered from cache. */
    inputHash: text("input_hash").notNull(),
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("program_contexts_program_version_uq")
      .on(t.programId, t.version)
      .where(sql`${t.version} is not null`),
    index("program_contexts_input_idx").on(t.inputHash),
  ],
);

export const programMembers = pgTable(
  "program_members",
  {
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.programId, t.userId] }),
    // "Which programs is this person a member of" (every owner page and the sidebar).
    index("program_members_user_idx").on(t.userId),
  ],
);

export const contributors = pgTable(
  "contributors",
  {
    id: id(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    xUserId: text("x_user_id").notNull(),
    xHandle: text("x_handle").notNull(),
    /** GitHub identity copied from the user's verified OAuth connection; the id is what ownership checks use. */
    githubLogin: text("github_login"),
    githubUserId: text("github_user_id"),
    githubVerifiedAt: timestamp("github_verified_at", { withTimezone: true }),
    walletAddress: text("wallet_address"),
    walletVerifiedAt: timestamp("wallet_verified_at", { withTimezone: true }),
    walletChangedAt: timestamp("wallet_changed_at", { withTimezone: true }),
    /** The exact signed message + signature, kept as ownership evidence. */
    walletProofMessage: text("wallet_proof_message"),
    walletProofSignature: text("wallet_proof_signature"),
    /** Wallet last registered as this contributor's payee in the vault, and that transaction. */
    payeeWallet: text("payee_wallet"),
    payeeTxHash: text("payee_tx_hash"),
    payeeRegisteredAt: timestamp("payee_registered_at", { withTimezone: true }),
    trustTier: integer("trust_tier").notNull().default(0),
    status: contributorStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("contributors_program_x_uq").on(t.programId, t.xUserId),
    // One payout wallet per contributor per program: blocks the simplest multi-account farming.
    uniqueIndex("contributors_program_wallet_uq").on(t.programId, t.walletAddress),
    index("contributors_user_idx").on(t.userId),
    // "Programs you joined": every program an X account is in.
    index("contributors_x_user_idx").on(t.xUserId),
  ],
);

// ─── Rounds, submissions, decisions ─────────────────────────────────────────

export const rounds = pgTable(
  "rounds",
  {
    id: id(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: roundStatus("status").notNull().default("open"),
    /** bytes32 roundId used on-chain. */
    roundIdBytes32: text("round_id_bytes32"),
    totalAmount: usdc("total_amount")
      .notNull()
      .default(sql`0`),
    decisionRoot: text("decision_root"),
    txHashPropose: text("tx_hash_propose"),
    txHashApprove: text("tx_hash_approve"),
    txHashExecute: text("tx_hash_execute"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    /** Last processing error (chain or upstream), shown to owners. */
    lastError: text("last_error"),
    /**
     * How many times this round was cancelled on-chain and re-planned. Each re-plan takes the next on-chain id
     * (`roundIdBytes32(id + ":retry" + n)`), so a cancelled id is never reused, across runs too.
     */
    replanCount: integer("replan_count").notNull().default(0),
    /** Lease held by the one worker run processing this round (two runs at once could pay twice). */
    lockOwner: text("lock_owner"),
    lockUntil: timestamp("lock_until", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("rounds_program_number_uq").on(t.programId, t.number)],
);

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => contributors.id),
    url: text("url").notNull(),
    sourceType: sourceType("source_type").notNull(),
    /** Canonical id: tweet id, "owner/repo#123", or normalized article URL. */
    resourceId: text("resource_id").notNull(),
    status: submissionStatus("status").notNull().default("pending"),
    amount: usdc("amount"),
    /** Last processing error shown to owners (never secrets or raw upstream bodies). */
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** The payout that pays this submission (set when a round is planned; cleared if that payout is abandoned). */
    payoutId: uuid("payout_id"),
    /** Last successful re-check at payout time; a re-plan or retry within a few hours doesn't fetch again. */
    recheckedAt: timestamp("rechecked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // A contributor can't have two live submissions of the same resource; a rejected one (e.g. NOT_MERGED) may be
    // resubmitted. Cross-contributor duplicates are kept and flagged DUPLICATE_URL.
    uniqueIndex("submissions_contributor_resource_live_uq")
      .on(t.contributorId, t.sourceType, t.resourceId)
      .where(sql`status <> 'rejected'`),
    index("submissions_program_resource_idx").on(t.programId, t.sourceType, t.resourceId),
    index("submissions_program_status_idx").on(t.programId, t.status),
    index("submissions_round_idx").on(t.roundId),
    index("submissions_payout_idx").on(t.payoutId),
    // A contributor's own submissions, newest first (their page and its status poll).
    index("submissions_contributor_created_idx").on(t.contributorId, t.createdAt),
  ],
);

export const fetchedResources = pgTable(
  "fetched_resources",
  {
    id: id(),
    sourceType: sourceType("source_type").notNull(),
    resourceId: text("resource_id").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    contentText: text("content_text").notNull(),
    contentHash: text("content_hash").notNull(),
    /** 64-bit SimHash as a signed bigint. */
    simhash: bigint("simhash", { mode: "bigint" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  // A GIN trigram index on content_text is added in the custom migration (pg_trgm).
  (t) => [uniqueIndex("fetched_resources_source_uq").on(t.sourceType, t.resourceId)],
);

export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    flagsJson: jsonb("flags_json").notNull(),
    llmOutputJson: jsonb("llm_output_json"),
    action: decisionAction("action").notNull(),
    amount: usdc("amount")
      .notNull()
      .default(sql`0`),
    /** Rubric category the decision scored against (null when rejected before judgment). */
    categoryKey: text("category_key"),
    /** Points as a decimal string, e.g. "7.50". */
    points: text("points"),
    /** Reviewer-style explanation shown in the UI; also inside decision_json. */
    summary: text("summary").notNull(),
    /** Canonical JSON (sorted keys) that was hashed. */
    decisionJson: text("decision_json").notNull(),
    decisionHash: text("decision_hash").notNull().unique(),
    signature: text("signature").notNull(),
    signerAddress: text("signer_address").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    ruleVersion: text("rule_version").notNull(),
    decidedBy: decidedBy("decided_by").notNull(),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    overrideReason: text("override_reason"),
    ...timestamps,
  },
  (t) => [index("decisions_submission_idx").on(t.submissionId)],
);

export const payouts = pgTable(
  "payouts",
  {
    id: id(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => contributors.id),
    payoutIdBytes32: text("payout_id_bytes32").notNull().unique(),
    /**
     * The on-chain round id this payout was planned under. A round re-planned under a new id keeps its old payouts;
     * releasing or recording acts only on the payouts of the id the chain reported.
     */
    roundIdBytes32: text("round_id_bytes32"),
    toAddress: text("to_address").notNull(),
    amount: usdc("amount").notNull(),
    decisionHash: text("decision_hash").notNull(),
    decisionRoot: text("decision_root"),
    txHash: text("tx_hash"),
    status: payoutStatus("status").notNull().default("pending"),
    ...timestamps,
  },
  (t) => [
    // One live payout per contributor per round. A payout cancelled with its on-chain round (status "failed") doesn't
    // count, so the round can be re-planned under a fresh on-chain id.
    uniqueIndex("payouts_round_contributor_uq")
      .on(t.roundId, t.contributorId)
      .where(sql`${t.status} <> 'failed'`),
    // A contributor's earnings and payout history.
    index("payouts_contributor_idx").on(t.contributorId),
  ],
);

// ─── Audit + usage ──────────────────────────────────────────────────────────

/** Append-only. UPDATE/DELETE raise an exception at the database level. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    programId: uuid("program_id").references(() => programs.id),
    /** "user:<uuid>", "agent", or "system". */
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    dataJson: jsonb("data_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_program_created_idx").on(t.programId, t.createdAt)],
);

export const apiUsage = pgTable(
  "api_usage",
  {
    id: id(),
    provider: text("provider").notNull(),
    endpoint: text("endpoint").notNull(),
    units: integer("units").notNull().default(1),
    estCostUsd: numeric("est_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    programId: uuid("program_id").references(() => programs.id),
    /** e.g. token counts. Never request/response bodies. */
    metaJson: jsonb("meta_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_usage_provider_created_idx").on(t.provider, t.createdAt)],
);

/** "Ask for a second look": one per submission, resolved by the owner's signed decision. */
export const appeals = pgTable(
  "appeals",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .unique()
      .references(() => submissions.id, { onDelete: "cascade" }),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => contributors.id),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    /** The decision hash the contributor asked about. */
    decisionHash: text("decision_hash").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** The owner's signed decision that answered it. */
    resolutionHash: text("resolution_hash"),
    ...timestamps,
  },
  (t) => [index("appeals_program_open_idx").on(t.programId, t.resolvedAt)],
);
