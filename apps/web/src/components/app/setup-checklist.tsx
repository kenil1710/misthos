import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui-kit/stepper";

export interface SetupStep {
  key: string;
  title: string;
  /** One line shown while this is the next step. */
  description: ReactNode;
  done: boolean;
  /** Shown under the description while this is the next step. */
  action?: ReactNode;
  /** Short line shown once done. */
  doneNote?: ReactNode;
}

/**
 * "Get your program live": the path from a new program to its first payout as one track with a progress bar. The
 * next step opens under the track with its action. Once every step is done this gives way to a quiet badge.
 */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.findIndex((s) => !s.done);
  const step = steps[next]!;
  return (
    <section aria-labelledby="setup-title" className="bg-card shadow-soft rounded-[1.25rem]">
      <div className="grid gap-5 p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h2 id="setup-title" className="display text-[1.75rem] leading-tight">
              Get your program live
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {done} of {steps.length} done. Next: {step.title.toLowerCase()}.
            </p>
          </div>
          <div
            className="bg-muted h-2 w-full overflow-hidden rounded-full sm:w-56"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={done}
            aria-label="Setup progress"
          >
            <div
              className="bg-brand h-full rounded-full transition-[width] duration-700"
              style={{ width: `${Math.max(4, (done / steps.length) * 100)}%` }}
            />
          </div>
        </div>
        <Stepper
          orientation="horizontal"
          size="sm"
          label="Setup steps"
          steps={steps.map((s, i) => ({
            key: s.key,
            label: s.title,
            status: s.done ? "done" : i === next ? "current" : "waiting",
            meta: s.done ? s.doneNote : undefined,
          }))}
        />
      </div>
      <div className="bg-muted/40 grid gap-2 rounded-b-[1.25rem] border-t px-5 py-5 sm:px-7">
        <p className="font-medium">
          {step.title}
          <span className="sr-only"> (next step)</span>
        </p>
        <p className="text-soft max-w-2xl text-sm leading-relaxed">{step.description}</p>
        {step.action ? <div className="mt-2">{step.action}</div> : null}
      </div>
    </section>
  );
}

/** What the track collapses to once the program is fully live. */
export function SetupComplete() {
  return (
    <span className="bg-brand-subtle text-brand inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium">
      <BadgeCheck className="size-3.5" strokeWidth={2} aria-hidden="true" />
      Setup complete
    </span>
  );
}

export function StepLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  );
}
