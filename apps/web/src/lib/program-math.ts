import { formatUsdc, parseUsdc } from "@misthos/shared/money";

/**
 * How a score becomes money, in one place (mirrors the agent's computeAmount):
 * each criterion is scored 0–10 → points = max points × average score ÷ 10 → payout = points × rate per point.
 */
export function perfectPayout(maxPoints: number, rate: bigint): bigint {
  return BigInt(Math.max(0, Math.floor(maxPoints))) * rate;
}

/** Payout for a given average criterion score (0–10). */
export function payoutFor(maxPoints: number, averageScore: number, rate: bigint): bigint {
  const tenths = BigInt(Math.round(Math.min(10, Math.max(0, averageScore)) * 10));
  return (BigInt(Math.floor(maxPoints)) * tenths * rate) / 100n;
}

export const tryParseUsdc = (v: string): bigint | null => {
  try {
    return v.trim() ? parseUsdc(v) : null;
  } catch {
    return null;
  }
};

const dec = (u: bigint) => formatUsdc(u, { withSymbol: false }).replace(/,/g, "");

/**
 * Safe limits for a new program, derived from what the rubric can pay: the largest item paid without review is the
 * best perfect submission; a contributor can earn about three of those per round; a round pays at most fifty items;
 * a day at most two rounds' worth; owner approval is needed for any round above a third of the round cap.
 */
export function deriveDefaultLimits(maxItem: bigint) {
  const item = maxItem > 0n ? maxItem : 1_000_000n;
  const perContributor = item * 3n;
  const perRound = perContributor * 5n;
  return {
    maxAutoApproveItem: dec(item),
    maxPerPayout: dec(perContributor),
    maxPerRound: dec(perRound),
    maxPerDay: dec(perRound * 2n),
    autoApproveThreshold: dec(perRound / 3n),
  };
}

export interface LimitNumbers {
  maxCategoryPayout: bigint | null;
  maxAutoApproveItem: bigint | null;
  maxPerPayout: bigint | null;
  maxPerRound: bigint | null;
  maxPerDay: bigint | null;
  autoApproveThreshold: bigint | null;
}

/** Combinations that are allowed but probably not what the owner meant. Errors (contract rules) live in the schema. */
export function limitWarnings(l: LimitNumbers): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  const usd = (u: bigint) => formatUsdc(u);
  if (
    l.maxAutoApproveItem !== null &&
    l.maxPerPayout !== null &&
    l.maxAutoApproveItem > l.maxPerPayout
  )
    out.push({
      field: "maxAutoApproveItem",
      text: `Items up to ${usd(l.maxAutoApproveItem)} skip review, but a contributor can't be paid more than ${usd(l.maxPerPayout)} per round, so those items would be capped.`,
    });
  if (
    l.maxCategoryPayout !== null &&
    l.maxPerPayout !== null &&
    l.maxCategoryPayout > l.maxPerPayout
  )
    out.push({
      field: "maxPerPayout",
      text: `A perfect submission earns ${usd(l.maxCategoryPayout)}, more than the ${usd(l.maxPerPayout)} a contributor can receive per round.`,
    });
  if (
    l.autoApproveThreshold !== null &&
    l.maxPerRound !== null &&
    l.autoApproveThreshold >= l.maxPerRound
  )
    out.push({
      field: "autoApproveThreshold",
      text: `No round can exceed ${usd(l.maxPerRound)}, so with a threshold of ${usd(l.autoApproveThreshold)} you'd never be asked to approve one.`,
    });
  if (l.maxCategoryPayout !== null && l.maxAutoApproveItem !== null && l.maxAutoApproveItem === 0n)
    out.push({ field: "maxAutoApproveItem", text: "Every submission will wait for your review." });
  return out;
}

const singularWord = (w: string) =>
  /ies$/.test(w) ? w.replace(/ies$/, "y") : /(ss|us)$/.test(w) ? w : w.replace(/s$/, "");

/**
 * What one item of a category is called, for sentences like "A perfect thread or post (10/10) earns 0.50 USDC".
 * Owners name categories in the plural ("Threads and posts", "Pull requests"); this turns that into the singular
 * ("thread or post", "pull request"). Names that aren't plural lists fall back to a quoted name: "“Code” submission".
 */
export function itemNoun(categoryName: string): string {
  const name = categoryName.trim();
  if (!name) return "submission";
  const parts = name.split(/\s*(?:,|\band\b|&|\bor\b|\/)\s*/i).filter(Boolean);
  const plural = parts.every((p) => /s$/i.test(p) && !/(ss|us)$/i.test(p));
  if (!plural) return `“${name}” submission`;
  const keepCase = (w: string) => (/^[A-Z]{2,}|^[A-Z][a-z]*[A-Z]/.test(w) ? w : w.toLowerCase());
  return parts
    .map((p) => {
      const words = p.split(/\s+/).map(keepCase);
      words[words.length - 1] = singularWord(words[words.length - 1]!);
      return words.join(" ");
    })
    .join(" or ");
}

/** "A perfect thread or post (10/10) earns 0.50 USDC" */
export function perfectLine(categoryName: string, amount: string): string {
  return `A perfect ${itemNoun(categoryName)} (10/10) earns ${amount}`;
}
