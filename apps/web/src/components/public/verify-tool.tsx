"use client";

import { ExternalLink, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SealArt } from "@/components/brand/illustrations";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Stepper } from "@/components/ui-kit/stepper";
import { cn } from "@/lib/utils";
import { revealDone, VERIFY_CHECKS, verifyStatuses, type CheckState } from "@/lib/verify-view";

interface Step {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  href?: string;
}
interface Result {
  verified: boolean;
  decisionHash: string | null;
  headline: string;
  steps: Step[];
}

export interface VerifyPick {
  hash: string;
  /** e.g. "@alice_builds · approved · 0.45 USDC" */
  label: string;
}

const REVEAL_MS = 380;

/** A published decision record, pretty-printed for the textarea; null when it can't be loaded. */
async function fetchRecord(hash: string): Promise<string | null> {
  const res = await fetch(`/api/public/decisions/${hash}`).catch(() => null);
  if (!res?.ok) return null;
  return JSON.stringify(JSON.parse(await res.text()), null, 2);
}

/**
 * Verify a decision in three moves: pick one of the latest decisions (or paste any record), press Verify, and watch
 * the five checks resolve one after another on the shared Stepper: the hash, Misthos published it, the agent signed
 * it, a payout commits to it, and the payout event on Arc matches. Nothing is taken on trust from Misthos: the server
 * recomputes everything from the pasted JSON and the chain.
 */
export function VerifyTool({
  initialHash,
  picks = [],
}: {
  initialHash?: string;
  picks?: VerifyPick[];
}) {
  const [record, setRecord] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  async function verify(text: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    setRevealed(0);
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
        startReveal();
      }
    } catch {
      setError("Couldn't reach Misthos. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // Reveal the checks one by one (all at once for reduced motion); focus moves to the verdict at the end.
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  function startReveal() {
    clearInterval(timer.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return setRevealed(VERIFY_CHECKS.length);
    let n = 0;
    timer.current = setInterval(() => {
      n += 1;
      setRevealed(n);
      if (revealDone(n)) clearInterval(timer.current);
    }, REVEAL_MS);
  }
  useEffect(() => () => clearInterval(timer.current), []);
  const finished = !!result && revealDone(revealed);
  useEffect(() => {
    if (finished) resultRef.current?.focus({ preventScroll: true });
  }, [finished]);

  async function load(hash: string) {
    const text = await fetchRecord(hash);
    if (!text) return setError("That decision record couldn't be loaded.");
    setRecord(text);
    void verify(text);
  }

  // "Verify" links elsewhere on the page point to #verify?d=<hash>; load that record and check it.
  useEffect(() => {
    const load = async (hash: string) => {
      const text = await fetchRecord(hash);
      if (!text) return setError("That decision record couldn't be loaded.");
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
    // Runs once per initial hash; verify() only reads state setters, so a stale copy is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHash]);

  const statuses = verifyStatuses(result, revealed, busy);
  const byId = new Map(result?.steps.map((s) => [s.id, s]));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="bg-card shadow-soft grid grid-cols-[minmax(0,1fr)] content-start gap-5 rounded-[1.5rem] p-5 sm:p-7">
        {picks.length ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
            <p className="text-sm font-medium" id="verify-picks">
              Pick a recent decision
            </p>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5" aria-labelledby="verify-picks">
              {picks.slice(0, 4).map((p) => (
                <li key={p.hash}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(p.hash);
                      void load(p.hash);
                    }}
                    disabled={busy}
                    aria-pressed={picked === p.hash}
                    className={cn(
                      "hover:bg-muted/70 flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors",
                      picked === p.hash && "border-brand bg-brand-subtle/60",
                    )}
                  >
                    <span className="min-w-0 truncate">{p.label}</span>
                    <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                      {p.hash.slice(0, 8)}…
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <form
          className="grid content-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPicked(null);
            void verify(record);
          }}
        >
          <Label htmlFor="verify-record">
            {picks.length ? "Or paste a decision record (JSON)" : "Decision record (JSON)"}
          </Label>
          <Textarea
            id="verify-record"
            rows={8}
            spellCheck={false}
            className="h-52 resize-y overflow-auto font-mono text-xs leading-relaxed [field-sizing:fixed]"
            placeholder='{"schema":"misthos.decision/v1", …}'
            value={record}
            onChange={(e) => setRecord(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || record.trim().length < 2}>
              {busy ? "Checking…" : "Verify"}
            </Button>
            <p className="text-muted-foreground text-xs">
              Or use Verify next to any decision on this page.
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}
        </form>
      </div>

      <div
        ref={resultRef}
        tabIndex={-1}
        aria-live="polite"
        aria-busy={busy || (!!result && !finished)}
        className="bg-card shadow-soft self-start rounded-[1.5rem] p-5 outline-none sm:p-7"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          {result && finished ? (
            <div className="min-w-0">
              <p
                className={cn(
                  "inline-flex items-center gap-2 text-sm font-medium",
                  result.verified ? "text-success" : "text-danger",
                )}
              >
                {result.verified ? (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                ) : (
                  <ShieldX className="size-4" aria-hidden="true" />
                )}
                {result.verified ? "Verified" : "Not verified"}
              </p>
              <p className="display mt-1 text-[1.5rem] leading-tight">{result.headline}</p>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="text-muted-foreground text-sm">
                {busy || result ? "Checking the record…" : "Five checks, in order"}
              </p>
              <p className="display mt-1 text-[1.5rem] leading-tight">
                {busy || result ? "Following the chain" : "Nothing taken on trust"}
              </p>
            </div>
          )}
          <SealArt
            className={cn(
              "size-14 shrink-0 transition-opacity duration-500",
              finished && result?.verified ? "opacity-100" : "opacity-30",
            )}
          />
        </div>
        <Stepper
          label="Verification checks"
          steps={VERIFY_CHECKS.map((c, i) => {
            const step = byId.get(c.id);
            const shown = !!result && i < revealed;
            return {
              key: c.id,
              label: c.label,
              status: statuses[i]!,
              detail:
                shown && step ? (
                  <span className="grid gap-1">
                    <span className="[overflow-wrap:anywhere]">{step.detail}</span>
                    {step.href ? (
                      <a
                        href={step.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
                      >
                        View the transaction on the Arc explorer
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{c.explains}</span>
                ),
            };
          })}
        />
      </div>
    </div>
  );
}
