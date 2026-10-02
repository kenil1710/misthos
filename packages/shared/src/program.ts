import { z } from "zod";
import { parseUsdc } from "./money";

/**
 * Program configuration schemas. The wizard posts decimal USDC strings ("12.50"); the server parses them into
 * 6-decimal base units. Stored JSON keeps base units as decimal-integer strings (JSON has no bigint).
 */

export const SOURCE_TYPES = ["x_post", "github_pr", "github_commit", "article"] as const;
export const SourceType = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof SourceType>;

/** Paths under the app root that a program slug must never shadow. */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "c",
  "docs",
  "join",
  "new",
  "p",
  "settings",
  "static",
  "www",
  "misthos",
]);

export const Slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/,
    "3–40 characters: lowercase letters, numbers and hyphens",
  )
  .refine((s) => !s.includes("--"), "No double hyphens")
  .refine((s) => !RESERVED_SLUGS.has(s), "This name is reserved");

/** Decimal USDC entered by a person, e.g. "25" or "12.50" → base units. */
export const UsdcInput = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, "Enter an amount like 25 or 12.50")
  .transform((s) => parseUsdc(s));

/** Base units serialized for JSON storage. */
export const UsdcUnitsString = z.string().regex(/^\d{1,24}$/);

const Key = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{0,31}$/, "Lowercase letters, numbers and underscores");

export const RubricCriterion = z.object({
  key: Key,
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(5).max(400),
});

export const RubricCategory = z.object({
  key: Key,
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(5).max(600),
  sourceTypes: z.array(SourceType).min(1).max(SOURCE_TYPES.length),
  /** Points awarded for a perfect submission; amount = points × ratePerPoint. */
  maxPoints: z.number().int().min(1).max(1000),
  criteria: z.array(RubricCriterion).min(1).max(8),
  /** Plain-language rules the agent applies, e.g. "Threads must be at least 4 posts." */
  rules: z.string().trim().max(2000).default(""),
  /** GitHub pull requests only: unmerged PRs are flagged NOT_MERGED. */
  requireMerged: z.boolean().default(true),
});

export const Rubric = z
  .object({
    categories: z.array(RubricCategory).min(1).max(10),
    generalRules: z.string().trim().max(4000).default(""),
  })
  .superRefine((r, ctx) => {
    const seen = new Set<string>();
    r.categories.forEach((c, i) => {
      if (seen.has(c.key))
        ctx.addIssue({
          code: "custom",
          path: ["categories", i, "key"],
          message: "Duplicate category key",
        });
      seen.add(c.key);
      const crit = new Set<string>();
      c.criteria.forEach((k, j) => {
        if (crit.has(k.key))
          ctx.addIssue({
            code: "custom",
            path: ["categories", i, "criteria", j, "key"],
            message: "Duplicate criterion key",
          });
        crit.add(k.key);
      });
    });
  });
export type Rubric = z.infer<typeof Rubric>;
export type RubricCategory = z.infer<typeof RubricCategory>;

export const ProgramBasics = z.object({
  name: z.string().trim().min(2).max(80),
  slug: Slug,
  description: z.string().trim().min(10).max(1000),
  logoUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(500)]).default(""),
});

/**
 * Vault limits as entered (decimal USDC). Mirrors MisthosVault._validateLimits:
 * maxPerPayout > 0, maxPerPayout ≤ maxPerRound ≤ maxPerDay.
 */
export const LimitsInput = z
  .object({
    maxPerPayout: UsdcInput,
    maxPerRound: UsdcInput,
    maxPerDay: UsdcInput,
    autoApproveThreshold: UsdcInput,
    payeeCooldownHours: z.coerce
      .number()
      .int()
      .min(0)
      .max(24 * 30),
  })
  .superRefine((l, ctx) => {
    if (l.maxPerPayout === 0n)
      ctx.addIssue({ code: "custom", path: ["maxPerPayout"], message: "Must be above zero" });
    if (l.maxPerRound < l.maxPerPayout)
      ctx.addIssue({
        code: "custom",
        path: ["maxPerRound"],
        message: "Must be at least the per-payout cap",
      });
    if (l.maxPerDay < l.maxPerRound)
      ctx.addIssue({
        code: "custom",
        path: ["maxPerDay"],
        message: "Must be at least the per-round cap",
      });
  });
export type LimitsInput = z.infer<typeof LimitsInput>;

export const BudgetInput = z.object({
  ratePerPoint: UsdcInput.refine((v) => v > 0n, "Must be above zero"),
  roundLengthDays: z.coerce.number().int().min(1).max(90),
  firstRoundStartsAt: z.coerce.date(),
  /** LLM confidence required for auto-approval (decision engine, Phase 3). */
  autoApproveConfidence: z.coerce.number().min(0.5).max(1),
  /** Items paying more than this always go to review, even when confident. */
  maxAutoApproveItem: UsdcInput,
  minAccountAgeDays: z.coerce.number().int().min(0).max(3650),
});
export type BudgetInput = z.infer<typeof BudgetInput>;

export const ProgramInput = z.object({
  basics: ProgramBasics,
  rubric: Rubric,
  budget: BudgetInput,
  limits: LimitsInput,
});
export type ProgramInput = z.infer<typeof ProgramInput>;

/** Limits as stored in programs.limits_json (base-unit strings). */
export const StoredLimits = z.object({
  maxPerPayout: UsdcUnitsString,
  maxPerRound: UsdcUnitsString,
  maxPerDay: UsdcUnitsString,
  autoApproveThreshold: UsdcUnitsString,
  payeeCooldownSeconds: z.number().int().min(0),
  maxAutoApproveItem: UsdcUnitsString,
});
export type StoredLimits = z.infer<typeof StoredLimits>;

export function toStoredLimits(limits: LimitsInput, budget: BudgetInput): StoredLimits {
  return {
    maxPerPayout: limits.maxPerPayout.toString(),
    maxPerRound: limits.maxPerRound.toString(),
    maxPerDay: limits.maxPerDay.toString(),
    autoApproveThreshold: limits.autoApproveThreshold.toString(),
    payeeCooldownSeconds: limits.payeeCooldownHours * 3600,
    maxAutoApproveItem: budget.maxAutoApproveItem.toString(),
  };
}

export const SOURCE_LABELS: Record<SourceType, string> = {
  x_post: "X posts",
  github_pr: "GitHub pull requests",
  github_commit: "GitHub commits",
  article: "Articles",
};
