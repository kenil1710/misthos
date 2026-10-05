import type { SourceType } from "@misthos/shared";

export const FLAG_CODES = [
  "OWNERSHIP_MISMATCH",
  "OWNERSHIP_UNVERIFIED",
  "OUT_OF_WINDOW",
  "DATE_UNVERIFIED",
  "DUPLICATE_URL",
  "NEAR_DUPLICATE",
  "NEW_ACCOUNT",
  "ENGAGEMENT_ANOMALY",
  "NOT_MERGED",
  "DELETED",
  "WALLET_CHANGED_RECENTLY",
  "PROMPT_INJECTION_ATTEMPT",
  "FETCH_FAILED",
  "MISSING_REQUIRED",
  "LOW_FOLLOWERS",
  "OFF_TOPIC",
  "CONTRADICTS_BRIEF",
] as const;
export type FlagCode = (typeof FLAG_CODES)[number];

export type Evidence = Record<string, string | number | boolean | null>;

/** A deterministic finding. Hard flags can never lead to payment; soft flags block auto-approval. */
export interface Flag {
  code: FlagCode;
  severity: "hard" | "soft";
  message: string;
  evidence: Evidence;
}

/** The normalized resource every check and the judge work from (also what we cache). */
export interface Resource {
  sourceType: SourceType;
  resourceId: string;
  url: string;
  /** The primary timestamp checked against the round window (post time, merge time, commit time, publish time). */
  timestamp: string | null;
  timestampKind: "posted" | "merged" | "opened" | "committed" | "published" | "unknown";
  title: string | null;
  /** Readable content: what the judge reads and what near-duplicate detection compares. */
  text: string;
  author: {
    id: string | null;
    handle: string | null;
    name: string | null;
    createdAt: string | null;
    followers: number | null;
  };
  x?: {
    isRepost: boolean;
    isReply: boolean;
    isQuote: boolean;
    likes: number;
    reposts: number;
    replies: number;
    quotes: number;
    impressions: number | null;
    lang: string | null;
    /** Expanded links in the post (or thread); missing on resources cached before this existed. */
    urls?: string[];
    /**
     * The author's self-reply chain read with the post, starting at the submitted post (just its own id for a single
     * post). Missing on resources cached before threads were read; those are fetched again.
     */
    thread?: { postIds: string[]; truncated: boolean; note: string | null };
  };
  github?: {
    repo: string;
    state: string | null;
    merged: boolean;
    mergedAt: string | null;
    additions: number;
    deletions: number;
    changedFiles: number;
    files: string[];
  };
  article?: {
    siteName: string | null;
    byline: string | null;
    /** Handles or profile links found anywhere on the page, lowercased (shown to reviewers; not proof). */
    xMentions: string[];
    /**
     * Handles named as the author by structured metadata only (twitter:creator, author meta tags, link rel=author,
     * JSON-LD author links); never visible text, bylines or display names. Missing on older cached articles.
     */
    authorHandles?: string[];
    /** Text hidden from readers (comments, display:none, alt text) — scanned for injection, never judged. */
    hiddenText: string;
  };
}

export type FetchOutcome =
  { status: "ok"; resource: Resource } | { status: "not_found"; detail: string };

export interface ApiUsageEntry {
  provider: "x" | "github" | "web" | "anthropic";
  endpoint: string;
  units: number;
  estCostUsd: number;
  meta?: Record<string, number | string>;
}

export interface FetchResult {
  outcome: FetchOutcome;
  usage: ApiUsageEntry[];
}

/** Upstream failure. `retryable` errors are retried by the queue; the rest become an escalation. */
export class FetchError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export type Fetch = typeof fetch;
