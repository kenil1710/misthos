import { requiresMerged, type RubricCategory } from "@misthos/shared";
import { notMerged } from "./checks";
import type { JudgmentOutput } from "./judge";
import type { Flag, Resource } from "./types";

/** Bump whenever a rule below changes. Recorded in every decision. */
export const RULE_VERSION = "rules-v7";

/** One contradicted claim, in the words owners and contributors both see. */
export const contradictionLine = (claim: string, briefSays: string) =>
  `Says "${claim.trim()}"; the brief says "${briefSays.trim()}".`;

/** Clear spam: the model is very sure the work doesn't qualify and every criterion scored 0 or 1. */
export const SPAM_CONFIDENCE = 0.9;
export const SPAM_MAX_SCORE = 1;

/**
 * The judge's own notes that mean "someone tried to steer me" (it's told to write "attempts to influence the grader").
 * Any of these sends the submission to a person, even if the judge then recommended approval (F-07).
 */
export const JUDGE_INJECTION_NOTE = new RegExp(
  [
    "influenc",
    "instruct",
    "grader",
    "inject",
    "manipulat",
    "jailbreak",
    "prompt",
    // Paraphrases (N-10): asking for marks, claiming approval, gaming the scoring, talking to the reviewer.
    "full marks",
    "(max|maximum|perfect|top|high) (score|marks|points)",
    "pre-?approv",
    "already approved",
    "approved by the (program )?owner",
    "\\bgam(e|es|ing)\\b.*(rubric|scor|review|grad)",
    "(rubric|scor).*\\bgam(e|es|ing)\\b",
    "addressed to the (ai|reviewer|judge|model|grader)",
    "\\b(ai|llm|model)\\b.*\\b(review|judge|grad|scor)",
    "ignore (the |all |previous |your )",
    "override",
    "bribe",
    "coerc",
  ].join("|"),
  "i",
);

/** Flags that end in rejection: the work can't be paid, whatever its quality. */
export const REJECT_FLAGS = new Set([
  "DELETED",
  "OWNERSHIP_MISMATCH",
  "DUPLICATE_URL",
  "OUT_OF_WINDOW",
  "NEAR_DUPLICATE",
  "NOT_MERGED",
  // Hard only when the owner chose "Reject automatically" (or "Can't join") for accounts below the minimums.
  "LOW_FOLLOWERS",
  "NEW_ACCOUNT",
]);

export interface EngineInput {
  flags: Flag[];
  judgment: JudgmentOutput | null;
  judgeError?: string;
  categories: RubricCategory[];
  resource: Resource | null;
  ratePerPoint: bigint;
  autoApproveConfidence: number;
  maxPerPayout: bigint;
  maxAutoApproveItem: bigint;
}

export type EngineAction = "approve" | "partial" | "reject" | "escalate";

export interface EngineDecision {
  action: EngineAction;
  /** Paid amount for approve/partial; the agent's recommendation for escalate; 0 for reject. */
  amount: bigint;
  points: string | null;
  categoryKey: string | null;
  auto: boolean;
  /** The rule that decided, e.g. "R1_REJECT_FLAG". */
  rule: string;
  /** Extra flags added after judgment (e.g. NOT_MERGED for the chosen category). */
  addedFlags: Flag[];
  cappedBy: "maxPerPayout" | null;
}

/**
 * The one points rule: points = maxPoints × Σscores / (10 × n), computed here from the judge's criterion scores and
 * kept exact as a rational, shown with 2 decimals. The judge's own `total_points` is recorded but never used, and
 * amount = points × rate always holds (before the per-payout cap). Work the judge recommends rejecting gets 0 points.
 */
export function computeAmount(cat: RubricCategory, scores: Record<string, number>, rate: bigint) {
  const n = BigInt(cat.criteria.length);
  const sum = BigInt(
    cat.criteria.reduce((s, k) => s + Math.min(10, Math.max(0, scores[k.key] ?? 0)), 0),
  );
  const num = BigInt(cat.maxPoints) * sum; // points = num / (10n * n)
  const den = 10n * n;
  const amount = (rate * num) / den; // ≤ rate × maxPoints, floored to base units
  const hundredths = (num * 100n) / den;
  const points = `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}`;
  return { amount, points };
}

export function decide(i: EngineInput): EngineDecision {
  const base = {
    addedFlags: [] as Flag[],
    cappedBy: null as EngineDecision["cappedBy"],
    auto: true,
  };
  const hardReject = i.flags.find((f) => f.severity === "hard" && REJECT_FLAGS.has(f.code));
  if (hardReject) {
    return {
      ...base,
      action: "reject",
      amount: 0n,
      points: null,
      categoryKey: i.judgment?.category ?? null,
      rule: "R1_REJECT_FLAG",
    };
  }

  // Price the agent's recommendation (used for approval, or pre-filled for a reviewer).
  let amount = 0n;
  let points: string | null = null;
  let cat: RubricCategory | undefined;
  const addedFlags: Flag[] = [];
  if (i.judgment) {
    cat = i.categories.find(
      (c) =>
        c.key === i.judgment!.category &&
        i.resource &&
        c.sourceTypes.includes(i.resource.sourceType),
    );
    if (cat && i.judgment.recommended_action === "reject") {
      // Never price work the judge says doesn't qualify: a reviewer who disagrees sets the amount themselves.
      points = "0.00";
    } else if (cat) {
      ({ amount, points } = computeAmount(cat, i.judgment.rubric_scores, i.ratePerPoint));
      if (
        requiresMerged(cat) &&
        i.resource?.sourceType === "github_pr" &&
        i.resource.github &&
        !i.resource.github.merged
      ) {
        addedFlags.push(notMerged(i.resource));
      }
    }
  }
  let cappedBy: EngineDecision["cappedBy"] = null;
  if (amount > i.maxPerPayout) {
    amount = i.maxPerPayout;
    cappedBy = "maxPerPayout";
  }
  const out = (
    action: EngineAction,
    rule: string,
    auto = action !== "escalate",
  ): EngineDecision => ({
    action,
    amount: action === "reject" ? 0n : amount,
    points,
    categoryKey: cat?.key ?? i.judgment?.category ?? null,
    auto,
    rule,
    addedFlags,
    cappedBy,
  });

  if (addedFlags.some((f) => f.severity === "hard")) return out("reject", "R1_REJECT_FLAG");
  if (i.flags.some((f) => f.code === "PROMPT_INJECTION_ATTEMPT"))
    return out("escalate", "R2_INJECTION");
  if (!i.judgment) return out("escalate", "R3_NO_JUDGMENT");
  if (i.judgment.soft_flags.some((f) => JUDGE_INJECTION_NOTE.test(f)))
    return out("escalate", "R2B_JUDGE_INJECTION");
  if (!cat) return out("escalate", "R4_CATEGORY_INVALID");
  // Against the program's brief (trusted context): off-topic work and claims that contradict its key facts.
  const offTopic = i.judgment.relevance === "off_topic";
  if (offTopic)
    addedFlags.push({
      code: "OFF_TOPIC",
      severity: "soft",
      message: "Not about what this program pays for, according to the program's brief.",
      evidence: { relevance: "off_topic" },
    });
  // Every contradicted claim is listed (the judge reports at most five), each quoting both sides.
  for (const f of (i.judgment.fact_checks ?? []).filter((x) => x.verdict === "contradicts"))
    addedFlags.push({
      code: "CONTRADICTS_BRIEF",
      severity: "soft",
      message: contradictionLine(f.claim, f.brief_says),
      evidence: { claim: f.claim, briefSays: f.brief_says },
    });
  // R5b: clearly off topic is rejected automatically (owners can override; contributors can ask for a second look).
  if (offTopic && i.judgment.confidence >= SPAM_CONFIDENCE) return out("reject", "R5B_OFF_TOPIC");
  // R5a: clear spam is rejected automatically (injection was already routed to a human by R2). Owners can override.
  const scores = cat.criteria.map((k) => i.judgment!.rubric_scores[k.key] ?? 0);
  if (
    i.judgment.recommended_action === "reject" &&
    i.judgment.confidence >= SPAM_CONFIDENCE &&
    scores.every((x) => x <= SPAM_MAX_SCORE)
  ) {
    return out("reject", "R5A_CLEAR_SPAM");
  }
  if (i.judgment.recommended_action === "reject" || i.judgment.recommended_action === "escalate") {
    return out("escalate", "R5_AGENT_RECOMMENDS_REVIEW");
  }
  if ([...i.flags, ...addedFlags].some((f) => f.severity === "soft"))
    return out("escalate", "R6_SOFT_FLAGS");
  if (i.judgment.confidence < i.autoApproveConfidence) return out("escalate", "R7_LOW_CONFIDENCE");
  if (amount === 0n) return out("escalate", "R8_ZERO_AMOUNT");
  if (amount > i.maxAutoApproveItem) return out("escalate", "R9_ABOVE_AUTO_CAP");
  // Articles have no platform-verified author or date: a person always approves them (never automatic).
  if (i.resource?.sourceType === "article") return out("escalate", "R9B_ARTICLE_REVIEW");
  return out(
    i.judgment.recommended_action === "partial" ? "partial" : "approve",
    "R10_AUTO_APPROVE",
  );
}
