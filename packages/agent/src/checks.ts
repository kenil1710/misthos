import type { RubricCategory, SourceType } from "@misthos/shared";
import { detectInjection } from "./injection";
import type { Flag, Resource } from "./types";

export const NEAR_DUPLICATE_HARD = 0.8;
export const NEAR_DUPLICATE_SOFT = 0.6;
export const NEAR_DUPLICATE_MIN_CHARS = 120;
const DAY_MS = 24 * 3600 * 1000;

export interface PriorMatch {
  submissionId: string;
  contributorId: string;
  xHandle: string;
  url: string;
  submittedAt: Date;
  /** pg_trgm similarity 0–1 */
  similarity: number;
  /** SimHash Hamming distance (0–64) when both fingerprints exist */
  hamming: number | null;
}

export interface CheckContext {
  sourceType: SourceType;
  resource: Resource | null;
  notFoundDetail?: string;
  contributor: {
    id: string;
    xUserId: string;
    xHandle: string;
    githubLogin: string | null;
    /** Verified through GitHub OAuth; null means the contributor hasn't connected GitHub. */
    githubUserId: string | null;
    walletChangedAt: Date | null;
  };
  round: { startsAt: Date; endsAt: Date };
  program: {
    minAccountAgeDays: number;
    payeeCooldownSeconds: number;
    categories: RubricCategory[];
  };
  /** Other contributors' submissions of the exact same resource. */
  sameResource: { submissionId: string; xHandle: string; submittedAt: Date }[];
  /** Most similar earlier submissions in the program (other resources). */
  similar: PriorMatch[];
  submittedAt: Date;
}

const pct = (n: number) => Math.round(n * 100);
const day = (d: Date) => d.toISOString().slice(0, 10);
const minute = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** Every deterministic check. Order is stable so records hash identically on replay. */
export function runChecks(ctx: CheckContext): Flag[] {
  const flags: Flag[] = [];
  const r = ctx.resource;

  if (!r) {
    flags.push({
      code: "DELETED",
      severity: "hard",
      message: ctx.notFoundDetail ?? "The linked content no longer exists.",
      evidence: { sourceType: ctx.sourceType },
    });
    return flags;
  }

  // ── Ownership ──────────────────────────────────────────────────────────
  if (r.sourceType === "x_post") {
    if (r.author.id !== ctx.contributor.xUserId) {
      flags.push({
        code: "OWNERSHIP_MISMATCH",
        severity: "hard",
        message: `Posted by @${r.author.handle ?? "unknown"}, not by the linked account @${ctx.contributor.xHandle}.`,
        evidence: {
          postAuthorId: r.author.id,
          postAuthorHandle: r.author.handle,
          linkedXUserId: ctx.contributor.xUserId,
        },
      });
    } else if (r.x?.isRepost) {
      flags.push({
        code: "OWNERSHIP_MISMATCH",
        severity: "hard",
        message: "This is a repost of someone else's post, not original work.",
        evidence: { repost: true },
      });
    }
  } else if (r.sourceType === "github_pr" || r.sourceType === "github_commit") {
    // Only a GitHub account connected through OAuth counts; usernames are never trusted (anyone can type one).
    const verified = ctx.contributor.githubUserId;
    const authorId = r.author.id;
    if (!verified || !authorId || authorId !== verified) {
      flags.push({
        code: "OWNERSHIP_MISMATCH",
        severity: "hard",
        message: !verified
          ? "Connect your GitHub account to submit GitHub work; it couldn't be matched to you."
          : !authorId
            ? "The commit isn't linked to a GitHub account, so authorship can't be confirmed."
            : `Authored by GitHub user ${r.author.handle ?? authorId}, not the connected account ${ctx.contributor.githubLogin ?? ""}.`.trim(),
        evidence: {
          githubAuthor: r.author.handle,
          githubAuthorId: authorId,
          connectedGithub: ctx.contributor.githubLogin,
          connectedGithubId: verified,
        },
      });
    }
  } else if (r.sourceType === "article") {
    const handle = ctx.contributor.xHandle.toLowerCase();
    if (!r.article?.xMentions.includes(handle)) {
      flags.push({
        code: "OWNERSHIP_UNVERIFIED",
        severity: "soft",
        message: `The article doesn't mention or link @${ctx.contributor.xHandle}, so authorship can't be confirmed automatically.`,
        evidence: { byline: r.article?.byline ?? null, expectedHandle: ctx.contributor.xHandle },
      });
    }
  }

  // ── Round window ───────────────────────────────────────────────────────
  if (r.timestamp) {
    const t = new Date(r.timestamp);
    if (t < ctx.round.startsAt || t >= ctx.round.endsAt) {
      flags.push({
        code: "OUT_OF_WINDOW",
        severity: "hard",
        message: (() => {
          // Dates alone read as a contradiction when the post and a boundary share a day; use times then.
          const close = day(t) === day(ctx.round.startsAt) || day(t) === day(ctx.round.endsAt);
          const f = close ? minute : day;
          const verb =
            r.timestampKind === "unknown"
              ? "Created"
              : r.timestampKind[0]!.toUpperCase() + r.timestampKind.slice(1);
          // Just outside a boundary, minutes alone can look identical; say how far off it was instead.
          const before = t < ctx.round.startsAt;
          const gap = Math.abs(
            t.getTime() - (before ? ctx.round.startsAt : ctx.round.endsAt).getTime(),
          );
          if (gap < 3_600_000) {
            const n = gap < 60_000 ? Math.max(1, Math.round(gap / 1000)) : Math.round(gap / 60_000);
            const unit = gap < 60_000 ? "second" : "minute";
            return `${verb} ${n} ${unit}${n === 1 ? "" : "s"} ${before ? "before this round started" : "after this round ended"} (${minute(ctx.round.startsAt)} to ${minute(ctx.round.endsAt)}).`;
          }
          return `${verb} ${close ? "at" : "on"} ${f(t)}, outside this round (${f(ctx.round.startsAt)} to ${f(ctx.round.endsAt)}).`;
        })(),
        evidence: {
          timestamp: r.timestamp,
          kind: r.timestampKind,
          roundStart: ctx.round.startsAt.toISOString(),
          roundEnd: ctx.round.endsAt.toISOString(),
        },
      });
    }
  } else {
    flags.push({
      code: "DATE_UNVERIFIED",
      severity: "soft",
      message: "No publication date was found, so the round window can't be confirmed.",
      evidence: { kind: r.timestampKind },
    });
  }

  // ── Duplicates ─────────────────────────────────────────────────────────
  const firstDup = [...ctx.sameResource].sort(
    (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime(),
  )[0];
  if (firstDup) {
    flags.push({
      code: "DUPLICATE_URL",
      severity: "hard",
      message: `Already submitted by @${firstDup.xHandle} on ${day(firstDup.submittedAt)}.`,
      evidence: {
        matchedSubmissionId: firstDup.submissionId,
        matchedHandle: firstDup.xHandle,
        matchedAt: firstDup.submittedAt.toISOString(),
      },
    });
  }

  if (r.text.length >= NEAR_DUPLICATE_MIN_CHARS) {
    const best = ctx.similar.filter(
      (m) => m.similarity >= NEAR_DUPLICATE_SOFT || (m.hamming !== null && m.hamming <= 3),
    )[0];
    if (best) {
      const sim = Math.max(best.similarity, best.hamming !== null ? 1 - best.hamming / 64 : 0);
      const otherPerson = best.contributorId !== ctx.contributor.id;
      const hard = otherPerson && sim >= NEAR_DUPLICATE_HARD;
      flags.push({
        code: "NEAR_DUPLICATE",
        severity: hard ? "hard" : "soft",
        message: otherPerson
          ? `${pct(sim)}% identical to a submission by @${best.xHandle} on ${day(best.submittedAt)}.`
          : `${pct(sim)}% identical to your own earlier submission from ${day(best.submittedAt)}.`,
        evidence: {
          matchedSubmissionId: best.submissionId,
          matchedHandle: best.xHandle,
          matchedUrl: best.url,
          matchedAt: best.submittedAt.toISOString(),
          trigramSimilarity: Math.round(best.similarity * 1000) / 1000,
          simhashDistance: best.hamming,
        },
      });
    }
  }

  // ── Account and engagement (X) ─────────────────────────────────────────
  if (r.sourceType === "x_post" && r.author.createdAt && ctx.program.minAccountAgeDays > 0) {
    const ageDays = Math.floor(
      (ctx.submittedAt.getTime() - new Date(r.author.createdAt).getTime()) / DAY_MS,
    );
    if (ageDays < ctx.program.minAccountAgeDays) {
      flags.push({
        code: "NEW_ACCOUNT",
        severity: "soft",
        message: `The X account is ${ageDays} days old; this program asks for at least ${ctx.program.minAccountAgeDays}.`,
        evidence: {
          accountCreatedAt: r.author.createdAt,
          ageDays,
          minAccountAgeDays: ctx.program.minAccountAgeDays,
        },
      });
    }
  }
  if (r.sourceType === "x_post" && r.x) {
    const followers = r.author.followers ?? 0;
    const engagement = r.x.likes + r.x.reposts;
    const inflated = engagement > Math.max(200, followers * 5);
    const impossible =
      r.x.impressions !== null &&
      r.x.impressions > 0 &&
      r.x.likes > r.x.impressions * 0.5 &&
      r.x.likes > 20;
    if (inflated || impossible) {
      flags.push({
        code: "ENGAGEMENT_ANOMALY",
        severity: "soft",
        message: impossible
          ? `${r.x.likes} likes on ${r.x.impressions} impressions is not a natural ratio.`
          : `${engagement} likes and reposts from an account with ${followers} followers is unusual.`,
        evidence: {
          likes: r.x.likes,
          reposts: r.x.reposts,
          impressions: r.x.impressions,
          followers,
        },
      });
    }
  }

  // ── GitHub merge state ─────────────────────────────────────────────────
  if (r.sourceType === "github_pr" && r.github && !r.github.merged) {
    const prCats = ctx.program.categories.filter((c) => c.sourceTypes.includes("github_pr"));
    if (prCats.length > 0 && prCats.every((c) => c.requireMerged)) flags.push(notMerged(r));
  }

  // ── Wallet ─────────────────────────────────────────────────────────────
  const wc = ctx.contributor.walletChangedAt;
  if (wc && ctx.submittedAt.getTime() - wc.getTime() < ctx.program.payeeCooldownSeconds * 1000) {
    flags.push({
      code: "WALLET_CHANGED_RECENTLY",
      severity: "soft",
      message: `The payout wallet changed on ${day(wc)}; payouts to it wait out the cooldown.`,
      evidence: {
        walletChangedAt: wc.toISOString(),
        cooldownSeconds: ctx.program.payeeCooldownSeconds,
      },
    });
  }

  // ── Prompt injection ───────────────────────────────────────────────────
  const injection = detectInjection([
    { source: "title", text: r.title ?? "" },
    { source: "content", text: r.text },
    { source: "hidden", text: r.article?.hiddenText ?? "" },
  ]);
  if (injection.length) {
    flags.push({
      code: "PROMPT_INJECTION_ATTEMPT",
      severity: "hard",
      message: `Contains text aimed at the grader ("${injection[0]!.snippet}").`,
      evidence: {
        patterns: injection.map((m) => m.pattern).join(","),
        snippet: injection[0]!.snippet,
        inHiddenText: injection.some((m) => m.source === "hidden"),
      },
    });
  }

  return flags;
}

export function notMerged(r: Resource): Flag {
  return {
    code: "NOT_MERGED",
    severity: "hard",
    message: "The pull request isn't merged. Resubmit it once it's merged.",
    evidence: { state: r.github?.state ?? null, merged: false },
  };
}
