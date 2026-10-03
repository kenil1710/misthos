"use client";

import { getChainConfig } from "@misthos/shared/chains";
import { shortHex } from "@misthos/shared/money";
import { AlertTriangle, Check, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { HexValue } from "@/components/hex-value";
import { Disclosure } from "@/components/ui-kit/disclosure";
import { Stepper, type Step } from "@/components/ui-kit/stepper";
import { EVIDENCE_LABELS } from "@/lib/flags";
import type { CheckLine, JourneyStep, ScoreLine } from "@/lib/journey";
import { cn } from "@/lib/utils";

const ARC_TX = (h: string) => `${getChainConfig().chain.blockExplorers!.default.url}/tx/${h}`;
const time = (iso?: string) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso))
    : undefined;

/**
 * A submission's journey on the shared Stepper. Failed steps say what failed; for contributors they also say how
 * to fix it. The paid step links its transaction.
 */
export function JourneyStepper({
  steps,
  audience,
  explorerTx = ARC_TX,
}: {
  steps: JourneyStep[];
  audience: "owner" | "contributor";
  explorerTx?: (hash: string) => string;
}) {
  const view: Step[] = steps.map((s) => ({
    key: s.key,
    label: s.label,
    status: s.state,
    meta:
      s.state === "done" || s.state === "failed"
        ? time(s.at)
        : s.state === "waiting" && s.at
          ? `by ${time(s.at)}`
          : undefined,
    detail: s.txHash ? (
      <a
        href={explorerTx(s.txHash)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-mono underline-offset-4 hover:underline"
      >
        {shortHex(s.txHash, 6, 4)}
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    ) : s.detail || (audience === "contributor" && s.fix) ? (
      <>
        {s.detail ? <span className="block">{s.detail}</span> : null}
        {audience === "contributor" && s.fix ? (
          <span className="text-foreground mt-1 block">How to fix it: {s.fix}</span>
        ) : null}
      </>
    ) : undefined,
  }));
  return <Stepper steps={view} size="sm" label="Submission progress" />;
}

function CheckIcon({ state }: { state: CheckLine["state"] }) {
  const Icon = state === "pass" ? Check : state === "warn" ? AlertTriangle : X;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full",
        state === "pass" && "bg-brand-subtle text-brand",
        state === "warn" && "bg-warning-subtle text-warning",
        state === "fail" && "bg-danger-subtle text-danger",
      )}
    >
      <Icon className="size-3" strokeWidth={2.5} />
    </span>
  );
}

function Evidence({ evidence }: { evidence: Record<string, unknown> }) {
  const rows = Object.entries(evidence).filter(
    ([, v]) => v !== null && v !== false && v !== "" && v !== undefined,
  );
  if (!rows.length) return null;
  return (
    <dl className="text-muted-foreground mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt>{EVIDENCE_LABELS[k] ?? k}</dt>
          <dd className="[overflow-wrap:anywhere]">
            {typeof v === "string" && /^https?:\/\//.test(v) ? (
              <a href={v} target="_blank" rel="noreferrer" className="underline">
                {v}
              </a>
            ) : v === true ? (
              "Yes"
            ) : (
              String(v).replace(/,(?=\S)/g, ", ")
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The agent's reasoning as a readable trace: checks, scores with why, and the result. */
export function ReasoningTrace({
  checks,
  scores,
  reasons,
  result,
  hash,
  verifyHref,
  confidence,
}: {
  checks: CheckLine[];
  scores: ScoreLine[];
  reasons: string[];
  result: { tone: "approved" | "rejected" | "review" | "pending"; title: string; body?: string };
  hash?: string;
  verifyHref?: string | null;
  confidence?: number;
}) {
  return (
    <div className="grid gap-5">
      <section aria-label="Checks">
        <h3 className="text-muted-foreground mb-2 text-xs">Checks</h3>
        <ul className="grid gap-1.5">
          {checks.map((c) => (
            <li key={c.key}>
              {c.state === "pass" ? (
                <span className="flex items-center gap-2.5 text-sm">
                  <CheckIcon state="pass" />
                  {c.label}
                </span>
              ) : (
                <Disclosure
                  title={
                    <span className="flex items-center gap-2.5 text-sm font-normal">
                      <CheckIcon state={c.state} />
                      <span className={c.state === "fail" ? "text-danger" : "text-warning"}>
                        {c.label}
                      </span>
                    </span>
                  }
                >
                  <div className="pt-1 pb-2 pl-7.5 text-sm">
                    {c.message ? <p className="text-soft">{c.message}</p> : null}
                    {c.evidence ? <Evidence evidence={c.evidence} /> : null}
                  </div>
                </Disclosure>
              )}
            </li>
          ))}
        </ul>
      </section>

      {scores.length ? (
        <section aria-label="Scores">
          <h3 className="text-muted-foreground mb-2 text-xs">
            Scores{confidence !== undefined ? ` · ${Math.round(confidence * 100)}% confident` : ""}
          </h3>
          <ul className="grid gap-2.5">
            {scores.map((s) => (
              <li
                key={s.key}
                className="grid grid-cols-[7rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm"
              >
                <span className="truncate">{s.name}</span>
                <span className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden="true">
                  <span
                    className="bg-brand block h-full rounded-full"
                    style={{ width: `${s.score * 10}%` }}
                  />
                </span>
                <span className="text-right text-xs tabular-nums">
                  {s.score}/10<span className="sr-only"> on {s.name}</span>
                </span>
              </li>
            ))}
          </ul>
          {reasons.length ? (
            <ul className="text-soft mt-3 grid gap-1 text-[13px] leading-relaxed">
              {reasons.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden="true" className="text-muted-foreground">
                    ·
                  </span>
                  {r}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section
        aria-label="Result"
        className={cn(
          "rounded-2xl p-4",
          result.tone === "approved" && "bg-brand-subtle",
          result.tone === "rejected" && "bg-danger-subtle",
          result.tone === "review" && "bg-warning-subtle",
          result.tone === "pending" && "bg-muted",
        )}
      >
        <p
          className={cn(
            "display text-2xl leading-tight",
            result.tone === "approved" && "text-brand",
            result.tone === "rejected" && "text-danger",
            result.tone === "review" && "text-warning",
          )}
        >
          {result.title}
        </p>
        {result.body ? (
          <p className="text-soft mt-1.5 text-sm leading-relaxed">{result.body}</p>
        ) : null}
      </section>

      {hash ? (
        <footer className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>Signed decision</span>
          <HexValue value={hash} label="decision hash" />
          {verifyHref ? (
            <Link
              href={verifyHref}
              className="text-foreground ml-auto underline underline-offset-4"
            >
              Verify
            </Link>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
