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
    /** Handles or profile links found anywhere on the page, lowercased. */
    xMentions: string[];
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
