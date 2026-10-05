/** One row of "submissions by status" for a contributor in a program. `amount` is the sum of their amounts. */
export interface StatusCount {
  status: string;
  n: number;
  amount: string;
}

export interface JoinedCounts {
  /** Everything they sent, whatever happened to it. */
  submitted: number;
  /** Not decided yet, or waiting for the program team (queued, processing, escalated). */
  inReview: number;
  /** Approved (fully or partly) but not in a paid round yet. */
  approved: number;
  approvedAmount: bigint;
  /** Approved and paid on-chain. */
  paid: number;
}

const IN_REVIEW = new Set(["pending", "processing", "escalated"]);
const APPROVED = new Set(["approved", "partial"]);

/**
 * A contributor's submissions in one program, by what they mean to them. Paid work counts as paid, not approved,
 * so a paid submission never shows as "0 approved".
 */
export function joinedCounts(rows: StatusCount[]): JoinedCounts {
  let submitted = 0;
  let inReview = 0;
  let approved = 0;
  let approvedAmount = 0n;
  let paid = 0;
  for (const r of rows) {
    submitted += r.n;
    if (IN_REVIEW.has(r.status)) inReview += r.n;
    else if (APPROVED.has(r.status)) {
      approved += r.n;
      approvedAmount += BigInt(r.amount);
    } else if (r.status === "paid") paid += r.n;
  }
  return { submitted, inReview, approved, approvedAmount, paid };
}
