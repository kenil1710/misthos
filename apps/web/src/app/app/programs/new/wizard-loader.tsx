"use client";

import { lazy, Suspense } from "react";
import { FocusHeader, FocusMain } from "@/components/app/focus-frame";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useHydrated } from "@/lib/use-hydrated";
import { STEP_META, STEPS } from "./wizard-steps";

const ProgramWizard = lazy(() => import("./wizard").then((m) => ({ default: m.ProgramWizard })));

/**
 * The wizard restores a locally saved draft on its first render, so it renders in the browser only. Until then the
 * server paints the same frame with the requested step's real headline (fast first paint, nothing jumps), and the
 * form fields as placeholders.
 */
export function WizardLoader({ step }: { step: number }) {
  const hydrated = useHydrated();
  const first = <WizardFirstPaint step={step} />;
  if (!hydrated) return first;
  return (
    <Suspense fallback={first}>
      <ProgramWizard />
    </Suspense>
  );
}

function WizardFirstPaint({ step }: { step: number }) {
  const meta = STEP_META[step]!;
  return (
    <>
      <FocusHeader />
      <FocusMain>
        <div className="grid items-start gap-12 pt-8 sm:pt-12 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)] xl:gap-20">
          <div className="min-w-0" aria-busy="true">
            <p className="text-brand text-sm font-medium">
              Step {step + 1} of {STEPS.length}
              <span className="text-muted-foreground font-normal"> · {STEPS[step]}</span>
            </p>
            <h1 className="display mt-2 text-[2.5rem] leading-[1.05] sm:text-[3.25rem]">
              {meta.title}
            </h1>
            <p className="text-soft mt-3 max-w-[56ch] text-[15px] leading-relaxed">{meta.intro}</p>
            {step === 0 ? (
              // Step 1's fields as they'll look, inert until the wizard takes over (and the largest paint is here).
              // Unlabelled and hidden from assistive tech: they are pictures of fields, so nothing (a screen reader, a
              // fast typist's autofill, a test) can find or fill them and lose the text when the real form mounts.
              <div className="mt-8 grid gap-6" inert aria-hidden="true">
                {(
                  [
                    ["Program name", "Arc Creators", false],
                    ["Join link", "arc-creators", false],
                    [
                      "Description",
                      "Pays builders for original threads, guides and pull requests that help others ship on Arc.",
                      true,
                    ],
                  ] as const
                ).map(([label, placeholder, area]) => (
                  <div key={label} className="grid gap-1.5">
                    <span className="text-sm font-medium">{label}</span>
                    {area ? (
                      <Textarea rows={4} placeholder={placeholder} tabIndex={-1} />
                    ) : (
                      <Input placeholder={placeholder} tabIndex={-1} />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-8 grid gap-6">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-28" />
              </div>
            )}
          </div>
          <Skeleton className="hidden h-[420px] rounded-[1.25rem] lg:block" />
        </div>
      </FocusMain>
    </>
  );
}
