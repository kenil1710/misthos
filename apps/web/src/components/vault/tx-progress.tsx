"use client";

import { Check, Circle, ExternalLink, Loader2, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { explorerTxUrl, type StepView } from "./use-owner-tx";

const SUB: Record<StepView["state"], string> = {
  idle: "Waiting",
  wallet: "Confirm in your wallet",
  pending: "Waiting for Arc to confirm",
  recording: "Confirmed. Recording it in Misthos",
  done: "Confirmed",
  failed: "Failed",
};

/** One row per transaction: what it is, where it stands, and a link to it on the explorer once it exists. */
export function TxProgress({
  steps,
  error,
  expired,
  busy,
  onRetry,
}: {
  steps: StepView[];
  error: string | null;
  expired?: boolean;
  busy: boolean;
  onRetry: () => void;
}) {
  if (!steps.length) return null;
  return (
    <div className="grid gap-3 rounded-lg border p-4" aria-live="polite">
      <ol className="grid gap-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <StepIcon state={s.state} />
            <div className="min-w-0">
              <p className={cn("font-medium", s.state === "idle" && "text-muted-foreground")}>
                {s.label}
              </p>
              <p
                className={cn(
                  "text-xs",
                  s.state === "failed" ? "text-danger" : "text-muted-foreground",
                )}
              >
                {s.state === "failed" && error ? error : SUB[s.state]}
                {s.hash ? (
                  <>
                    {" · "}
                    <a
                      href={explorerTxUrl(s.hash)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      View transaction
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {error ? (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {expired ? (
            <Button asChild size="sm">
              <Link href="/app">Sign in again</Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StepIcon({ state }: { state: StepView["state"] }) {
  const cls = "mt-0.5 size-4 shrink-0";
  if (state === "done") return <Check className={cn(cls, "text-success")} strokeWidth={2} />;
  if (state === "failed") return <X className={cn(cls, "text-danger")} strokeWidth={2} />;
  if (state === "idle")
    return <Circle className={cn(cls, "text-muted-foreground")} strokeWidth={1.5} />;
  return <Loader2 className={cn(cls, "text-foreground animate-spin")} strokeWidth={1.5} />;
}
