"use client";

import { FileSearch, Link2, ScanLine, Sparkles, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Stepper, type Step, type StepStatus } from "@/components/ui-kit/stepper";
import { cn } from "@/lib/utils";

const STAGES = [
  { key: "submitted", label: "Submitted", meta: "just now", icon: Link2 },
  { key: "fetched", label: "Content fetched", meta: "1s", icon: FileSearch },
  {
    key: "checks",
    label: "Checks passed",
    meta: "2s",
    icon: ScanLine,
    detail: "Posted by the linked account · inside the round · original",
  },
  { key: "scored", label: "Scored 8/10 on depth, 7/10 on clarity", meta: "41s", icon: Sparkles },
  { key: "paid", label: "Paid on Arc", meta: "round close", icon: Wallet },
] as const;

/**
 * The landing hero's product moment: one submission moving through review to payment, on a loop. Uses the same
 * Stepper as the app. With reduced motion it shows the finished journey, still.
 */
export function HeroMoment() {
  const [at, setAt] = useState<number>(STAGES.length);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Starts on the finished journey (also what the server renders), then replays it.
    let i: number = STAGES.length;
    const t = setInterval(() => {
      i = i >= STAGES.length + 2 ? 0 : i + 1; // a few beats on the finished state, then start over
      setAt(Math.min(i, STAGES.length));
    }, 1300);
    return () => clearInterval(t);
  }, []);

  const steps: Step[] = STAGES.map((s, i) => {
    const status: StepStatus = i < at ? "done" : i === at ? "current" : "waiting";
    return {
      key: s.key,
      label: s.label,
      icon: s.icon,
      status,
      meta: i < at ? s.meta : undefined,
      detail: "detail" in s && i < at ? s.detail : undefined,
    };
  });
  const paid = at >= STAGES.length;
  const decided = at >= 4;

  return (
    <div className="bg-card shadow-lift relative w-full max-w-[26rem] rounded-[1.75rem] p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="bg-brand-subtle text-brand flex size-10 items-center justify-center rounded-full font-medium"
        >
          A
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">@ada_builds</p>
          <p className="text-muted-foreground truncate font-mono text-xs">
            x.com/ada_builds/status/18…42
          </p>
        </div>
        <span className="bg-muted text-muted-foreground ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs whitespace-nowrap">
          X post
        </span>
      </div>
      <p className="text-soft mt-4 text-sm leading-relaxed">
        &ldquo;How Arc settles payroll, in four posts: fees in dollars, six-decimal accounting, and
        why finality matters.&rdquo;
      </p>
      <div className="bg-background/60 mt-5 rounded-2xl p-4">
        <Stepper steps={steps} size="sm" label="Submission progress" />
      </div>
      <div
        className={cn(
          "mt-5 flex items-end justify-between transition-opacity duration-500",
          decided ? "opacity-100" : "opacity-0",
        )}
        aria-live="polite"
      >
        <div>
          <p className="text-muted-foreground text-xs">
            {paid ? "Paid to @ada_builds" : "Approved"}
          </p>
          <p className="display text-brand mt-0.5 text-4xl leading-none">
            0.40 <span className="text-xl not-italic">USDC</span>
          </p>
        </div>
        <span
          className={cn(
            "text-muted-foreground font-mono text-xs transition-opacity duration-500",
            paid ? "opacity-100" : "opacity-0",
          )}
        >
          tx 0x7f3a…c21e
        </span>
      </div>
    </div>
  );
}
