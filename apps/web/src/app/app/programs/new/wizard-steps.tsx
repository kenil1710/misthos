import type { ReactNode } from "react";

/** The wizard's steps, shared by the wizard and its server-rendered first paint (so both show the same headline). */
export const STEPS = ["Basics", "Context", "Rubric", "Budget and schedule", "Review"] as const;

/** Each step's headline (one italic word, the display style) and the one sentence under it. */
export const STEP_META: { title: ReactNode; intro: string }[] = [
  {
    title: (
      <>
        Name your <em>program</em>
      </>
    ),
    intro:
      "What contributors see first on the join page. You can change the name and description later.",
  },
  {
    title: (
      <>
        Brief the <em>agent</em>
      </>
    ),
    intro:
      "What the project is and what you want contributors to make. The agent reads it, and your links, once, and checks every submission against it.",
  },
  {
    title: (
      <>
        What do you <em>pay</em> for?
      </>
    ),
    intro:
      "Categories of work, the points each is worth, and the criteria the agent scores against. Start from the example and make it yours.",
  },
  {
    title: (
      <>
        Pay, schedule and <em>limits</em>
      </>
    ),
    intro:
      "How much a point is worth, when rounds run, and the caps your vault enforces on-chain whatever the agent decides.",
  },
  {
    title: (
      <>
        Ready to <em>create</em>
      </>
    ),
    intro:
      "Check everything once. Creating saves a draft: nothing is published and no money moves until you choose to.",
  },
];
