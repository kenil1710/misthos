import { formatUsdc } from "@misthos/shared/money";
import type { SourceType } from "@misthos/shared/sources";
import { FLAG_COPY, flagLabel } from "./flags";

/**
 * A submission's journey and the agent's reasoning, as data for the Stepper and the reasoning trace. Pure, so the
 * owner drawer, the board and the contributor's cards all tell the same story.
 */

export type StepState = "done" | "current" | "waiting" | "failed" | "skipped";

export interface FlagLike {
  code: string;
  severity: "hard" | "soft" | string;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface JourneyInput {
  status: "pending" | "processing" | "approved" | "partial" | "rejected" | "escalated" | "paid";
  createdAt: string | Date;
  decision: {
    action: string;
    amount: string | bigint;
    createdAt: string | Date;
    flags: FlagLike[];
    scored: boolean;
    decidedBy: "agent" | "human";
  } | null;
  round: { number: number; status: string; endsAt: string | Date } | null;
  payout: { status: string; txHash: string | null } | null;
}

export interface JourneyStep {
  key: "submitted" | "fetched" | "checks" | "scored" | "decision" | "round" | "paid";
  label: string;
  state: StepState;
  at?: string;
  detail?: string;
  /** For contributors: what to do differently, when a check failed. */
  fix?: string;
  txHash?: string;
}

const CHECK_CODES = new Set([
  "OWNERSHIP_MISMATCH",
  "OWNERSHIP_UNVERIFIED",
  "OUT_OF_WINDOW",
  "DATE_UNVERIFIED",
  "DUPLICATE_URL",
  "NEAR_DUPLICATE",
  "PROMPT_INJECTION_ATTEMPT",
  "NEW_ACCOUNT",
  "ENGAGEMENT_ANOMALY",
  "WALLET_CHANGED_RECENTLY",
  "NOT_MERGED",
]);
const FETCH_CODES = new Set(["FETCH_FAILED", "DELETED"]);

const iso = (d: string | Date) => (typeof d === "string" ? d : d.toISOString());

export function submissionJourney(j: JourneyInput): JourneyStep[] {
  const d = j.decision;
  const flags = d?.flags ?? [];
  const fetchFail = flags.find((f) => FETCH_CODES.has(f.code));
  const hardCheck = flags.find((f) => CHECK_CODES.has(f.code) && f.severity === "hard");
  const injection = flags.find((f) => f.code === "PROMPT_INJECTION_ATTEMPT");
  const softChecks = flags.filter((f) => CHECK_CODES.has(f.code) && f.severity !== "hard");
  const inFlight = j.status === "pending" || j.status === "processing";
  const action = d?.action ?? null;
  const rejected = action === "reject" || j.status === "rejected";
  const escalated = j.status === "escalated";
  const paid = j.status === "paid" || j.payout?.status === "executed";
  const approved = j.status === "approved" || j.status === "partial" || paid;

  const steps: JourneyStep[] = [
    { key: "submitted", label: "Submitted", state: "done", at: iso(j.createdAt) },
  ];
  // Fetch
  steps.push(
    fetchFail
      ? {
          key: "fetched",
          label: FLAG_COPY[fetchFail.code]?.label ?? "Couldn't open the link",
          state: "failed",
          detail: fetchFail.message,
          fix: FLAG_COPY[fetchFail.code]?.fix,
        }
      : {
          key: "fetched",
          label: inFlight ? "Fetching the content" : "Content fetched",
          state: inFlight ? "current" : "done",
        },
  );
  // Checks
  steps.push(
    inFlight
      ? { key: "checks", label: "Checks", state: "waiting" }
      : fetchFail
        ? { key: "checks", label: "Checks", state: "skipped" }
        : hardCheck && !escalated
          ? {
              key: "checks",
              label: flagLabel(hardCheck.code),
              state: "failed",
              detail: hardCheck.message,
              fix: FLAG_COPY[hardCheck.code]?.fix,
            }
          : injection || (hardCheck && escalated)
            ? {
                key: "checks",
                label: flagLabel((injection ?? hardCheck)!.code),
                state: "current",
                detail: (injection ?? hardCheck)!.message,
                fix: FLAG_COPY[(injection ?? hardCheck)!.code]?.fix,
              }
            : {
                key: "checks",
                label: softChecks.length
                  ? `Checks passed, ${softChecks.length} note${softChecks.length === 1 ? "" : "s"}`
                  : "Checks passed",
                state: "done",
                detail: softChecks.length
                  ? softChecks.map((f) => flagLabel(f.code, f.severity)).join(" · ")
                  : undefined,
              },
  );
  // Scored
  steps.push({
    key: "scored",
    label: "Agent scored",
    state: inFlight ? "waiting" : d?.scored ? "done" : "skipped",
  });
  // Decision
  const amount = d ? formatUsdc(BigInt(d.amount)) : "";
  steps.push(
    inFlight || !d
      ? { key: "decision", label: "Decision", state: "waiting" }
      : escalated
        ? {
            key: "decision",
            label: "Waiting for the team's review",
            state: "current",
            detail: BigInt(d.amount) > 0n ? `The agent recommends ${amount}` : undefined,
          }
        : rejected
          ? { key: "decision", label: "Rejected", state: "failed", at: iso(d.createdAt) }
          : {
              key: "decision",
              label: `${action === "partial" ? "Partially approved" : "Approved"} · ${amount}`,
              state: "done",
              at: iso(d.createdAt),
              detail: d.decidedBy === "human" ? "Decided by the program team" : undefined,
            },
  );
  // Round
  steps.push(
    rejected
      ? { key: "round", label: "Added to round", state: "skipped" }
      : approved && j.round
        ? { key: "round", label: `Added to round ${j.round.number}`, state: "done" }
        : { key: "round", label: "Added to round", state: "waiting" },
  );
  // Paid
  const paying = j.round && ["closed", "proposed", "approved"].includes(j.round.status);
  steps.push(
    rejected
      ? { key: "paid", label: "Paid", state: "skipped" }
      : paid
        ? {
            key: "paid",
            label: "Paid on Arc",
            state: "done",
            txHash: j.payout?.txHash ?? undefined,
          }
        : approved && paying
          ? { key: "paid", label: "Being paid", state: "current" }
          : approved && j.round
            ? {
                key: "paid",
                label: "Paid when the round closes",
                state: "waiting",
                at: iso(j.round.endsAt),
              }
            : { key: "paid", label: "Paid", state: "waiting" },
  );
  return steps;
}

export interface CheckLine {
  key: string;
  label: string;
  state: "pass" | "warn" | "fail";
  message?: string;
  /** One line each, e.g. every claim that contradicts the brief. */
  items?: string[];
  evidence?: Record<string, unknown>;
}

const GROUPS: { key: string; codes: string[]; pass: (s: SourceType, summary: string) => string }[] =
  [
    {
      key: "ownership",
      codes: ["OWNERSHIP_MISMATCH", "OWNERSHIP_UNVERIFIED"],
      pass: (s) =>
        s === "x_post"
          ? "Posted by the linked account"
          : s === "article"
            ? "Mentions the contributor's account"
            : "Authored by the connected GitHub account",
    },
    { key: "timing", codes: ["OUT_OF_WINDOW", "DATE_UNVERIFIED"], pass: () => "Inside the round" },
    {
      key: "originality",
      codes: ["DUPLICATE_URL", "NEAR_DUPLICATE"],
      pass: (_s, summary) => {
        const n = /No duplicate found across (\d+) prior submission/.exec(summary)?.[1];
        return n
          ? `No duplicate across ${n} submission${n === "1" ? "" : "s"}`
          : "No duplicate found";
      },
    },
    {
      key: "safety",
      codes: ["PROMPT_INJECTION_ATTEMPT"],
      pass: () => "No instructions aimed at the grader",
    },
  ];
const EXTRA = [
  "NEW_ACCOUNT",
  "ENGAGEMENT_ANOMALY",
  "WALLET_CHANGED_RECENTLY",
  "NOT_MERGED",
  "DELETED",
  "FETCH_FAILED",
];

const BRIEF_EXTRA = ["OFF_TOPIC", "MISSING_REQUIRED", "LOW_FOLLOWERS"];

/** Every claim that contradicts the program's brief, as "Says X; the brief says Y." */
export function contradictions(
  flags: { code: string; severity?: string; message: string }[],
): string[] {
  return flags.filter((f) => f.code === "CONTRADICTS_BRIEF" && f.message).map((f) => f.message);
}

/** The checks as one line each: passed (✓), noted (soft flag) or failed (hard flag), with the evidence. */
export function reasoningChecks(
  flags: FlagLike[],
  sourceType: SourceType,
  summary: string,
): CheckLine[] {
  const line = (f: FlagLike): CheckLine => ({
    key: f.code,
    label:
      f.code === "PROMPT_INJECTION_ATTEMPT" ? "Injection detected" : flagLabel(f.code, f.severity),
    state: f.severity === "hard" ? "fail" : "warn",
    message: f.message,
    evidence: f.evidence,
  });
  const out: CheckLine[] = [];
  for (const g of GROUPS) {
    const hit = flags.filter((f) => g.codes.includes(f.code));
    if (hit.length) out.push(...hit.map(line));
    else out.push({ key: g.key, label: g.pass(sourceType, summary), state: "pass" });
  }
  for (const f of flags) if (EXTRA.includes(f.code)) out.push(line(f));
  // Against the program's brief: every contradicted claim on one line, quoting both sides.
  const facts = contradictions(flags);
  if (facts.length)
    out.push({
      key: "brief-facts",
      label:
        facts.length === 1
          ? "1 claim conflicts with the brief"
          : `${facts.length} claims conflict with the brief`,
      state: "warn",
      items: facts,
    });
  for (const f of flags) if (BRIEF_EXTRA.includes(f.code)) out.push(line(f));
  return out;
}

export interface ScoreLine {
  key: string;
  name: string;
  score: number;
}

/** Rubric scores in the category's own order, with names. */
export function scoreLines(
  scores: Record<string, number> | undefined,
  criteria: { key: string; name: string }[],
): ScoreLine[] {
  if (!scores) return [];
  return criteria
    .filter((c) => typeof scores[c.key] === "number")
    .map((c) => ({ key: c.key, name: c.name, score: scores[c.key]! }));
}

/** Board columns, in the order an owner reads them. */
export const BOARD_STAGES = [
  { key: "needs", label: "Needs you", statuses: ["escalated"] },
  { key: "processing", label: "Processing", statuses: ["pending", "processing"] },
  { key: "approved", label: "Approved", statuses: ["approved", "partial"] },
  { key: "paid", label: "Paid", statuses: ["paid"] },
  { key: "rejected", label: "Rejected", statuses: ["rejected"] },
] as const;

export function boardStage(status: string): (typeof BOARD_STAGES)[number]["key"] {
  return (
    BOARD_STAGES.find((s) => (s.statuses as readonly string[]).includes(status))?.key ??
    "processing"
  );
}
