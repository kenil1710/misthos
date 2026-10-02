"use client";

import { Check, ExternalLink, Minus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  label: string;
  state: "pass" | "fail" | "skip";
  detail: string;
  href?: string;
}
interface Result {
  verified: boolean;
  decisionHash: string | null;
  headline: string;
  steps: Step[];
}

const ICON = { pass: Check, fail: X, skip: Minus };

/**
 * Paste (or pick) a decision record; the server recomputes its hash, checks the agent's signature, and matches the
 * payout's PayoutExecuted event on Arc. Results render as a chain: each link is one check with its evidence.
 */
export function VerifyTool({ initialHash }: { initialHash?: string }) {
  const [record, setRecord] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  async function verify(text: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/public/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record: text }),
      });
      const body = (await res.json()) as Result & { error?: string };
      if (!res.ok)
        setError(body.error ?? "Verification is unavailable right now. Try again shortly.");
      else {
        setResult(body);
        requestAnimationFrame(() => resultRef.current?.focus());
      }
    } catch {
      setError("Couldn't reach Misthos. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // "Verify" buttons elsewhere on the page link to #verify?d=<hash>; load that record and check it.
  useEffect(() => {
    const load = async (hash: string) => {
      const res = await fetch(`/api/public/decisions/${hash}`);
      if (!res.ok) return setError("That decision record couldn't be loaded.");
      const text = JSON.stringify(JSON.parse(await res.text()), null, 2);
      setRecord(text);
      void verify(text);
    };
    const fromHash = () => {
      const m = /[?&]d=(0x[0-9a-fA-F]{64})/.exec(window.location.hash);
      if (m) void load(m[1]!.toLowerCase());
    };
    if (initialHash) void load(initialHash);
    else fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [initialHash]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <form
        className="grid content-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void verify(record);
        }}
      >
        <Label htmlFor="verify-record">Decision record (JSON)</Label>
        <Textarea
          id="verify-record"
          rows={12}
          spellCheck={false}
          className="font-mono text-xs leading-relaxed"
          placeholder='{"schema":"misthos.decision/v1", …}'
          value={record}
          onChange={(e) => setRecord(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || record.trim().length < 2}>
            {busy ? "Checking…" : "Verify"}
          </Button>
          <p className="text-muted-foreground text-xs">
            Paste a record, or use Verify next to any decision below.
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}
      </form>

      <div
        ref={resultRef}
        tabIndex={-1}
        aria-live="polite"
        className="rounded-lg border p-4 outline-none"
      >
        {!result ? (
          <p className="text-muted-foreground text-sm">
            The check recomputes the record&apos;s keccak256 hash, verifies the agent&apos;s
            signature over it, and matches the payout&apos;s PayoutExecuted event on Arc. Nothing is
            taken on trust from Misthos.
          </p>
        ) : (
          <>
            <p
              className={cn(
                "text-sm font-medium",
                result.verified ? "text-success" : "text-danger",
              )}
            >
              {result.headline}
            </p>
            <ol className="mt-4 grid">
              {result.steps.map((s, i) => {
                const Icon = ICON[s.state];
                const last = i === result.steps.length - 1;
                return (
                  <li key={s.id} className="grid grid-cols-[24px_1fr] gap-x-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full border",
                          s.state === "pass" && "border-success bg-success-subtle text-success",
                          s.state === "fail" && "border-danger bg-danger-subtle text-danger",
                          s.state === "skip" && "text-muted-foreground",
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden="true" />
                      </span>
                      {!last ? (
                        <span
                          className={cn(
                            "w-px flex-1",
                            s.state === "pass" ? "bg-success/40" : "bg-border",
                          )}
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                    <div className={cn("pb-4", last && "pb-0")}>
                      <p className="text-sm font-medium">
                        {s.label}
                        <span className="sr-only">
                          {" "}
                          (
                          {s.state === "pass"
                            ? "passed"
                            : s.state === "fail"
                              ? "failed"
                              : "not checked"}
                          )
                        </span>
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-[13px] break-words">
                        {s.detail}
                      </p>
                      {s.href ? (
                        <a
                          href={s.href}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[13px] hover:underline"
                        >
                          View the transaction on the Arc explorer{" "}
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
