/**
 * A program's minimum X followers and account age, against one contributor's X account: what they have, what the
 * program asks for, and what happens to their posts. Pure, so the join page, the contributor page, the join route
 * and the owner's overview all say the same thing.
 */

export type BelowMinimum = "review" | "reject" | "block";

export const BELOW_MINIMUM_CHOICES: { value: BelowMinimum; label: string; detail: string }[] = [
  {
    value: "review",
    label: "Send to my review",
    detail: "They can join and post; their work waits for you.",
  },
  {
    value: "reject",
    label: "Reject automatically",
    detail: "They can join, but everything they submit is rejected without review.",
  },
  { value: "block", label: "Can't join", detail: "They can't join with that account." },
];

export interface MinimumRules {
  minXFollowers: number;
  minAccountAgeDays: number;
  belowMinimum: BelowMinimum;
}

export interface MinimumStatus {
  /** The program has at least one minimum. */
  applies: boolean;
  followers: { have: number | null; need: number; ok: boolean | null } | null;
  age: { days: number | null; need: number; ok: boolean | null } | null;
  /** Below at least one minimum (unknown counts are never "below"). */
  below: boolean;
  outcome: "ok" | BelowMinimum;
  /** One sentence for the contributor. */
  text: string;
}

const DAY_MS = 86_400_000;
const n = (x: number) => x.toLocaleString("en");

export function minimumStatus(
  rules: MinimumRules,
  account: { followers: number | null; createdAt: Date | null },
  now: Date = new Date(),
  /** Already a member (joined before "Can't join" was chosen): their posts are rejected instead. */
  member = false,
): MinimumStatus {
  const followers =
    rules.minXFollowers > 0
      ? {
          have: account.followers,
          need: rules.minXFollowers,
          ok: account.followers === null ? null : account.followers >= rules.minXFollowers,
        }
      : null;
  const days = account.createdAt
    ? Math.floor((now.getTime() - account.createdAt.getTime()) / DAY_MS)
    : null;
  const age =
    rules.minAccountAgeDays > 0
      ? {
          days,
          need: rules.minAccountAgeDays,
          ok: days === null ? null : days >= rules.minAccountAgeDays,
        }
      : null;
  const below = followers?.ok === false || age?.ok === false;
  const outcome = below ? rules.belowMinimum : "ok";
  const misses = [
    followers?.ok === false
      ? `${n(followers.have!)} followers (this program asks for ${n(followers.need)})`
      : null,
    age?.ok === false
      ? `an account ${age.days} days old (this program asks for ${age.need})`
      : null,
  ].filter(Boolean);
  const text =
    !followers && !age
      ? "This program has no minimum followers or account age."
      : !below
        ? "Your X account meets this program's minimums."
        : `You have ${misses.join(" and ")}. ${
            outcome === "review"
              ? "You can join and post; the team reviews your work before it's paid."
              : member
                ? "Everything you submit from this account is rejected automatically."
                : outcome === "reject"
                  ? "You can join, but everything you submit is rejected automatically."
                  : "You can't join with this account."
          }`;
  return { applies: !!followers || !!age, followers, age, below, outcome, text };
}

/** The rule as contributors read it on the join page, before signing in. */
export function minimumRuleText(rules: MinimumRules): string | null {
  const parts = [
    rules.minXFollowers > 0 ? `fewer than ${n(rules.minXFollowers)} followers` : null,
    rules.minAccountAgeDays > 0 ? `younger than ${rules.minAccountAgeDays} days` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  const who = `X accounts with ${parts.join(" or ")}`.replace("with younger", "younger");
  // Every kind of work counts (posts, articles, code): the X account is the one used to sign in.
  const from = `All submissions from ${who}`;
  return rules.belowMinimum === "review"
    ? `${from} are reviewed by the team before payment.`
    : rules.belowMinimum === "reject"
      ? `${from} are rejected automatically.`
      : `${who} can't join.`;
}

/** The overview's "Submission rules" card: one [label, value] row per rule, in plain words. */
export function submissionRuleRows(p: {
  minXFollowers: number;
  minAccountAgeDays: number;
  belowMinimum: BelowMinimum;
  maxSubmissionsPerRound: number;
  mustInclude: string[];
  acceptsArticles: boolean;
}): [string, string][] {
  const policy = BELOW_MINIMUM_CHOICES.find((c) => c.value === p.belowMinimum)!.label;
  const rows: [string, string][] = [
    ["Minimum X followers", p.minXFollowers > 0 ? n(p.minXFollowers) : "None"],
    ["Minimum account age", p.minAccountAgeDays > 0 ? `${p.minAccountAgeDays} days` : "None"],
  ];
  if (p.minXFollowers > 0 || p.minAccountAgeDays > 0) rows.push(["Below the minimums", policy]);
  rows.push(
    ["Submissions per round", `Up to ${p.maxSubmissionsPerRound} per contributor`],
    ["Required mention", p.mustInclude.length ? p.mustInclude.join(", ") : "None"],
  );
  if (p.acceptsArticles) rows.push(["Articles", "Always reviewed by you"]);
  return rows;
}
