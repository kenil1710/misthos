/** What each vault limit protects against, in the owner's words. Shared by the wizard and Settings. */
export const LIMIT_HELP = {
  maxPerPayout:
    "The most one contributor can receive in a round. Caps the damage if the agent or a reviewer over-rewards someone.",
  maxPerRound:
    "The most a whole round can pay out. Protects the budget if many submissions are approved at once.",
  maxPerDay:
    "The most the vault can pay in any 24 hours, across rounds. A hard ceiling on how fast funds can leave.",
  autoApproveThreshold:
    "Rounds that pay out more than this wait for your signature. Below it, the agent pays automatically.",
  payeeCooldownHours:
    "How long a new or changed payout wallet waits before it can be paid. Protects contributors whose account is taken over.",
  maxAutoApproveItem:
    "Single submissions worth more than this always go to your review queue instead of being approved automatically.",
  autoApproveConfidence:
    "How sure the agent must be (0.5 to 1) to approve on its own. Below this, the submission comes to you.",
} as const;
