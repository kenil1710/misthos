import { formatUsdc, type RubricCategory } from "@misthos/shared";
import type { EngineDecision } from "./engine";
import type { JudgmentOutput } from "./judge";
import type { Flag, Resource } from "./types";

/**
 * The one-paragraph explanation shown to contributors and owners, and published in the decision record.
 * Deterministic: built from facts (flags, scores, engine rule), with the model's own summary quoted where useful.
 */
export function explain(p: {
  decision: EngineDecision;
  flags: Flag[];
  judgment: JudgmentOutput | null;
  categories: RubricCategory[];
  resource: Resource | null;
  priorCount: number;
  judgeError?: string;
}): string {
  const { decision: d, judgment: j } = p;
  const flags = [...p.flags, ...d.addedFlags];
  const cat = p.categories.find((c) => c.key === d.categoryKey);
  const scoreLine = () => {
    if (!j || !cat) return "";
    const parts = cat.criteria.map(
      (k) => `${j.rubric_scores[k.key] ?? 0}/10 on ${k.name.toLowerCase()}`,
    );
    const list =
      parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    return ` Scored ${list}.`;
  };
  const provenance = () => {
    const r = p.resource;
    if (!r) return "";
    const what = {
      x_post: "Posted",
      github_pr: r.github?.merged ? "Merged" : "Opened",
      github_commit: "Committed",
      article: "Published",
    }[r.sourceType];
    const who =
      r.sourceType === "article" ? "linked to the contributor's account" : "by the linked account";
    return ` ${what} inside the round ${who}.`;
  };
  const dupLine = () =>
    p.priorCount > 0
      ? ` No duplicate found across ${p.priorCount} prior submission${p.priorCount === 1 ? "" : "s"}.`
      : "";
  const cap = d.cappedBy === "maxPerPayout" ? " Capped at the program's per-payout limit." : "";
  // Every claim that contradicts the brief, whatever the outcome.
  const contradictions = flags.filter((f) => f.code === "CONTRADICTS_BRIEF").map((f) => f.message);
  const factLine = () =>
    contradictions.length
      ? ` Fact check: ${contradictions.length === 1 ? "1 claim conflicts" : `${contradictions.length} claims conflict`} with the brief. ${contradictions.join(" ")}`
      : "";

  if (d.action === "reject" && d.rule === "R5A_CLEAR_SPAM") {
    return `Rejected automatically as clearly outside this program's rubric. ${j!.quality_summary}${scoreLine()}${factLine()} The program team can override this decision.`
      .replace(/\s+/g, " ")
      .trim();
  }

  if (d.action === "reject" && d.rule === "R5B_OFF_TOPIC") {
    return `Rejected automatically: not about what this program pays for, according to its brief. ${j?.quality_summary ?? ""}${factLine()} The program team can override this decision.`
      .replace(/\s+/g, " ")
      .trim();
  }

  if (d.action === "reject") {
    const f = flags.find((x) => x.severity === "hard")!;
    const tail: Partial<Record<Flag["code"], string>> = {
      NEAR_DUPLICATE: " Recycled content isn't paid under this program's rules.",
      DUPLICATE_URL: " Each piece of work is paid once.",
      OWNERSHIP_MISMATCH: " Only work by the linked account is paid.",
      OUT_OF_WINDOW: " Only work from inside the round counts.",
      DELETED: "",
      NOT_MERGED: "",
    };
    return `Rejected. ${f.message}${tail[f.code] ?? ""}${factLine()}`;
  }

  if (d.action === "approve" || d.action === "partial") {
    const label = d.action === "partial" ? "Partially approved" : "Approved";
    return `${label} · ${formatUsdc(d.amount)}.${provenance()} ${j!.quality_summary}${scoreLine()}${dupLine()}${cap}${factLine()}`
      .replace(/\s+/g, " ")
      .trim();
  }

  // Escalated: say why a human needs to look, and what the agent would do.
  const rec = d.amount > 0n ? ` The agent recommends ${formatUsdc(d.amount)}.` : "";
  const why: Record<string, string> = {
    R2_INJECTION: `${flags.find((f) => f.code === "PROMPT_INJECTION_ATTEMPT")?.message ?? "Contains text aimed at the grader."} Submissions that try to influence scoring always get a human review.`,
    R2B_JUDGE_INJECTION:
      "The reviewing model noticed text aimed at it, so a person reviews this one, whatever the scores.",
    R3_NO_JUDGMENT: `The agent couldn't complete its review${p.judgeError ? ` (${p.judgeError})` : ""}.`,
    R4_CATEGORY_INVALID: "The agent couldn't match this to a rubric category.",
    R5_AGENT_RECOMMENDS_REVIEW:
      j?.recommended_action === "reject"
        ? "The agent recommends rejecting this (no payment) and wants a reviewer to confirm."
        : "The agent wants a reviewer's judgment on this one.",
    // Contradictions are listed once, in the fact-check line below.
    R6_SOFT_FLAGS: flags
      .filter((f) => f.severity === "soft" && f.code !== "CONTRADICTS_BRIEF")
      .map((f) => f.message)
      .join(" "),
    R7_LOW_CONFIDENCE: `The agent's confidence (${j ? Math.round(j.confidence * 100) : 0}%) is below this program's auto-approval threshold.`,
    R8_ZERO_AMOUNT: "The work scored zero points.",
    R9_ABOVE_AUTO_CAP: "The amount is above what this program approves without review.",
    R5B_OFF_TOPIC:
      "The agent is confident this isn't about what the program pays for (see the program's brief).",
    R9B_ARTICLE_REVIEW:
      "Articles are always reviewed by a person: their author and date come from the page itself, not a platform.",
  };
  const summary = j ? ` ${j.quality_summary}` : "";
  return `Escalated for review. ${why[d.rule] ?? ""}${factLine()}${rec}${summary}${scoreLine()}`
    .replace(/\s+/g, " ")
    .trim();
}
