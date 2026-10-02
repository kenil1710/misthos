/** Flags in plain words: a label for reviewers, and what a contributor can do differently next time. */
export const FLAG_COPY: Record<string, { label: string; fix: string }> = {
  OWNERSHIP_MISMATCH: {
    label: "Not the contributor's work",
    fix: "Submit only work published from your own linked account. Reposts and other people's posts aren't paid.",
  },
  OWNERSHIP_UNVERIFIED: {
    label: "Authorship couldn't be confirmed",
    fix: "For articles, mention or link your X handle in the article so it can be matched to you.",
  },
  OUT_OF_WINDOW: {
    label: "Outside the round",
    fix: "Submit work published after the current round started. Older work isn't eligible.",
  },
  DATE_UNVERIFIED: {
    label: "No publication date",
    fix: "Make sure the page shows a publication date so it can be matched to the round.",
  },
  DUPLICATE_URL: {
    label: "Already submitted",
    fix: "Each link can be submitted once per program.",
  },
  NEAR_DUPLICATE: {
    label: "Copied or recycled text",
    fix: "Submit original work. Text that closely matches an earlier submission isn't paid.",
  },
  NEW_ACCOUNT: {
    label: "New X account",
    fix: "This program asks for an older X account; the team will review it by hand.",
  },
  ENGAGEMENT_ANOMALY: {
    label: "Unusual engagement",
    fix: "Engagement far beyond the account's reach is checked by a person before paying.",
  },
  NOT_MERGED: {
    label: "Pull request not merged",
    fix: "This program pays for merged pull requests. Submit it again once it's merged.",
  },
  DELETED: {
    label: "Content no longer exists",
    fix: "Keep submitted work online until the round is paid.",
  },
  WALLET_CHANGED_RECENTLY: {
    label: "Payout wallet changed recently",
    fix: "Payouts to a new wallet wait out the program's cooldown.",
  },
  PROMPT_INJECTION_ATTEMPT: {
    label: "Text aimed at the grader",
    fix: "Don't include instructions to the reviewer or the AI. Submissions that do always go to a person.",
  },
  FETCH_FAILED: {
    label: "Couldn't open the link",
    fix: "Check the link is public and opens without signing in.",
  },
};

export const flagLabel = (code: string) =>
  FLAG_COPY[code]?.label ?? code.replace(/_/g, " ").toLowerCase();

/** Evidence keys as words; anything unlisted is shown as-is. */
export const EVIDENCE_LABELS: Record<string, string> = {
  snippet: "Matched text",
  patterns: "Patterns",
  inHiddenText: "Hidden in page",
  similarity: "Similarity",
  trigramSimilarity: "Text similarity",
  hamming: "Fingerprint distance",
  matchedUrl: "Matches",
  matchedSubmissionId: "Earlier submission",
  author: "Posted by",
  expected: "Expected",
  repost: "Repost",
  publishedAt: "Published",
  roundStart: "Round starts",
  roundEnd: "Round ends",
  ageDays: "Account age (days)",
  minAccountAgeDays: "Required age (days)",
  likes: "Likes",
  reposts: "Reposts",
  impressions: "Impressions",
  followers: "Followers",
  merged: "Merged",
  walletChangedAt: "Wallet changed",
};
