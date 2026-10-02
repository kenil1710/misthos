"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Plain-language definitions for the words Misthos can't avoid. Each links to the doc that explains it fully. */
export const GLOSSARY = {
  vault: {
    text: "The contract that holds this program's USDC. You own it; the agent can only pay out inside its limits.",
    href: "/docs/guardrails",
  },
  agent: {
    text: "Misthos's AI reviewer. It checks each submission, scores it, and signs its decision. It can't exceed your vault limits.",
    href: "/docs/how-the-agent-decides",
  },
  decisionHash: {
    text: "A fingerprint of the agent's signed decision record. Anyone can recompute it and check it against the payment on Arc.",
    href: "/docs/audit-trail",
  },
  cooldown: {
    text: "How long a new or changed payout wallet waits before it can be paid. Protects contributors if their account is taken over.",
    href: "/docs/guardrails#limits",
  },
  needsReview: {
    text: "The agent wasn't sure enough to decide alone (low confidence, unusual signals, a large amount, or text aimed at the grader), so it's waiting for you.",
    href: "/docs/how-the-agent-decides#rules",
  },
  round: {
    text: "A pay period. When it closes, approved work is totalled per contributor and paid from the vault in one transaction.",
    href: "/docs/quickstart",
  },
  approvalThreshold: {
    text: "Rounds that pay out more than this wait for your signature before the agent can send them.",
    href: "/docs/guardrails#limits",
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;

export function Term({ k, children }: { k: GlossaryKey; children: ReactNode }) {
  const g = GLOSSARY[k];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="decoration-muted-foreground/60 hover:decoration-foreground focus-visible:ring-ring/50 cursor-help rounded-sm underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-3"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-[18rem] flex-col items-start py-2 leading-relaxed"
      >
        <span>{g.text}</span>
        <Link href={g.href} className="underline underline-offset-2 opacity-80 hover:opacity-100">
          Learn more
        </Link>
      </TooltipContent>
    </Tooltip>
  );
}
