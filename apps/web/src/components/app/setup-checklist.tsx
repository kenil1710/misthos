import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
 * "Get your program live": the path from a new program to its first payout, with progress. The first unfinished step
 * is open with its action; finished steps collapse to a check; later steps wait.
 */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.findIndex((s) => !s.done);
  return (
    <section aria-labelledby="setup-title" className="bg-card rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div>
          <h2 id="setup-title" className="text-base font-medium">
            Get your program live
          </h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {done} of {steps.length} done. Next: {steps[next]!.title.toLowerCase()}.
          </p>
        </div>
        <div
          className="bg-muted h-1.5 w-40 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          aria-label="Setup progress"
        >
          <div
            className="bg-brand h-full rounded-full transition-[width]"
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </div>
      </div>
      <ol className="divide-y">
        {steps.map((s, i) => {
          const current = i === next;
          return (
            <li
              key={s.key}
              className={cn("flex gap-4 px-5 py-4 sm:px-6", current && "bg-muted/30")}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
                  s.done && "bg-foreground border-foreground text-background",
                  current && "border-foreground",
                  !s.done && !current && "text-muted-foreground",
                )}
                aria-hidden="true"
              >
                {s.done ? <Check className="size-3.5" strokeWidth={2.5} /> : i + 1}
              </span>
              <div className="grid min-w-0 flex-1 gap-1">
                <p className={cn("font-medium", !s.done && !current && "text-muted-foreground")}>
                  {s.title}
                  <span className="sr-only">
                    {s.done ? " (done)" : current ? " (next step)" : ""}
                  </span>
                </p>
                {s.done && s.doneNote ? (
                  <p className="text-muted-foreground text-sm">{s.doneNote}</p>
                ) : null}
                {current ? (
                  <>
                    <p className="text-muted-foreground text-sm leading-relaxed">{s.description}</p>
                    {s.action ? <div className="mt-3">{s.action}</div> : null}
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function StepLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  );
}
