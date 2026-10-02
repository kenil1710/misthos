"use client";

import { formatUsdc, shortHex } from "@misthos/shared";
import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StatusBadge, type Status } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface FlagView {
  code: string;
  severity: "hard" | "soft";
  message: string;
  evidence: Record<string, string | number | boolean | null>;
}
interface Detail {
  submission: {
    id: string;
    url: string;
    status: Status;
    amount: string | null;
    createdAt: string;
    lastError: string | null;
  };
  contributor: { xHandle: string; githubLogin: string | null; wallet: string | null };
  content: {
    title: string | null;
    author: string | null;
    timestamp: string | null;
    text: string;
    truncated: boolean;
  } | null;
  decisions: {
    id: string;
    action: string;
    amount: string;
    points: string | null;
    categoryKey: string | null;
    summary: string;
    flags: FlagView[];
    llm: {
      rubric_scores: Record<string, number>;
      reasons: string[];
      confidence: number;
      quality_summary: string;
      soft_flags: string[];
    } | null;
    model: string | null;
    promptVersion: string | null;
    ruleVersion: string;
    decidedBy: "agent" | "human";
    overrideReason: string | null;
    decisionHash: string;
    createdAt: string;
  }[];
}

/** Same timestamp format as the rest of the app: "2026-10-02 09:37 UTC". */
const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

const toDecimal = (units: string) => {
  const v = BigInt(units);
  return `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, "0")}`.replace(/\.?0+$/, "");
};

export function ReviewDrawer({
  submissionId,
  onClose,
  maxPerPayout,
}: {
  submissionId: string | null;
  onClose: () => void;
  maxPerPayout: string;
}) {
  return (
    <Sheet open={submissionId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {/* Keyed so each submission starts with fresh state. */}
        {submissionId ? (
          <DrawerBody key={submissionId} submissionId={submissionId} maxPerPayout={maxPerPayout} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  submissionId,
  maxPerPayout,
}: {
  submissionId: string;
  maxPerPayout: string;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [waitingFor, setWaitingFor] = useState<number | null>(null);

  const fetchDetail = useCallback(async (): Promise<Detail | null> => {
    const res = await fetch(`/api/owner/submissions/${submissionId}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as Detail) : null;
  }, [submissionId]);
  const load = useCallback(async () => {
    const d = await fetchDetail();
    if (d) setDetail(d);
    else setError("Couldn't load this submission.");
    return d;
  }, [fetchDetail]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await fetchDetail();
      if (cancelled) return;
      if (!d) return setError("Couldn't load this submission.");
      setDetail(d);
      const latest = d.decisions[0];
      setAmount(latest && latest.amount !== "0" ? toDecimal(latest.amount) : "");
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchDetail]);

  // After an override, poll until the worker has written the signed human decision.
  useEffect(() => {
    if (waitingFor === null) return;
    const t = setInterval(async () => {
      const d = await load();
      if (d && d.decisions.length > waitingFor) {
        setWaitingFor(null);
        router.refresh();
      }
    }, 2000);
    return () => clearInterval(t);
  }, [waitingFor, load, router]);

  async function override(action: "approve" | "reject") {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/owner/submissions/${detail.submission.id}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve" ? { action, amount, reason } : { action, reason },
        ),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) setError(body.error ?? "Couldn't save the decision.");
      else setWaitingFor(detail.decisions.length);
    } finally {
      setBusy(false);
    }
  }

  const latest = detail?.decisions[0];
  const agent = detail?.decisions.find((d) => d.decidedBy === "agent");
  const decided = detail && !["pending", "processing", "paid"].includes(detail.submission.status);
  const reasonOk = reason.trim().length >= 10;

  return (
    <>
      <SheetHeader>
        <SheetTitle>Review submission</SheetTitle>
        <SheetDescription>
          {detail
            ? `@${detail.contributor.xHandle} · ${utc(detail.submission.createdAt)}`
            : "Loading…"}
        </SheetDescription>
      </SheetHeader>
      {!detail ? (
        <div className="grid gap-3 px-4">
          {error ? <p className="text-danger text-sm">{error}</p> : <Skeleton className="h-40" />}
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 px-4 pb-8 text-sm">
          <div className="flex items-center justify-between gap-3">
            <StatusBadge status={detail.submission.status} />
            <a
              href={detail.submission.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 hover:underline"
            >
              <span className="truncate">{detail.submission.url.replace(/^https?:\/\//, "")}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          </div>

          {latest ? (
            <section>
              <h3 className="font-medium">
                {latest.decidedBy === "human" ? "Reviewer decision" : "Agent decision"}
              </h3>
              <p className="mt-1">{latest.summary}</p>
              <p className="text-muted-foreground mt-2 font-mono text-[11px] break-all">
                {shortHex(latest.decisionHash, 8, 6)} · {latest.ruleVersion}
                {latest.promptVersion ? ` · ${latest.promptVersion}` : ""}
                {latest.model ? ` · ${latest.model}` : ""}
              </p>
            </section>
          ) : detail.submission.lastError ? (
            <p className="text-warning">Retrying: {detail.submission.lastError}</p>
          ) : (
            <p className="text-muted-foreground">The agent hasn&apos;t decided yet.</p>
          )}

          {latest && latest.flags.length > 0 ? (
            <section>
              <h3 className="font-medium">Flags</h3>
              <ul className="mt-2 grid gap-2">
                {latest.flags.map((f) => (
                  <li key={f.code} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${f.severity === "hard" ? "bg-danger-subtle text-danger" : "bg-warning-subtle text-warning"}`}
                      >
                        {f.code}
                      </span>
                      <span className="text-muted-foreground text-xs">{f.severity}</span>
                    </div>
                    <p className="mt-1">{f.message}</p>
                    <dl className="text-muted-foreground mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11px]">
                      {Object.entries(f.evidence).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt>{k}</dt>
                          <dd className="break-all">
                            {typeof v === "string" && /^https?:\/\//.test(v) ? (
                              <a href={v} target="_blank" rel="noreferrer" className="underline">
                                {v}
                              </a>
                            ) : (
                              String(v)
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {agent?.llm ? (
            <section>
              <h3 className="font-medium">Rubric scores · {agent.categoryKey}</h3>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1">
                {Object.entries(agent.llm.rubric_scores).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="capitalize">{k.replace(/_/g, " ")}</dt>
                    <dd className="font-mono tabular-nums">{v}/10</dd>
                  </div>
                ))}
                <dt className="text-muted-foreground">Points · confidence</dt>
                <dd className="font-mono tabular-nums">
                  {agent.points} · {Math.round(agent.llm.confidence * 100)}%
                </dd>
              </dl>
              <ul className="mt-3 list-disc pl-5">
                {agent.llm.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.content ? (
            <section>
              <h3 className="font-medium">Content</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                {[
                  detail.content.author && `by ${detail.content.author}`,
                  detail.content.timestamp && utc(detail.content.timestamp),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {detail.content.title ? (
                <p className="mt-2 font-medium">{detail.content.title}</p>
              ) : null}
              <pre className="bg-muted mt-2 max-h-72 overflow-auto rounded-md p-3 font-sans text-[13px] whitespace-pre-wrap">
                {detail.content.text}
                {detail.content.truncated ? "\n…" : ""}
              </pre>
            </section>
          ) : null}

          {decided ? (
            <section className="grid gap-3 border-t pt-5">
              <h3 className="font-medium">Your decision</h3>
              <div className="grid gap-1.5">
                <Label htmlFor="ov-amount">Amount (USDC)</Label>
                <Input
                  id="ov-amount"
                  inputMode="decimal"
                  className="max-w-40 font-mono tabular-nums"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  Up to {formatUsdc(BigInt(maxPerPayout))} (vault per-payout limit). Change it to
                  adjust.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ov-reason">Reason (required, saved with the decision)</Label>
                <Textarea
                  id="ov-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              {error ? (
                <p role="alert" className="text-danger">
                  {error}
                </p>
              ) : null}
              {waitingFor !== null ? (
                <p className="text-muted-foreground">Recording and signing your decision…</p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  disabled={busy || !reasonOk || !amount || waitingFor !== null}
                  onClick={() => override("approve")}
                >
                  {agent && amount && toDecimal(agent.amount) !== amount && agent.amount !== "0"
                    ? "Adjust and approve"
                    : "Approve"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !reasonOk || waitingFor !== null}
                  onClick={() => override("reject")}
                >
                  Reject
                </Button>
              </div>
            </section>
          ) : null}

          {detail.decisions.length > 1 ? (
            <section>
              <h3 className="font-medium">History</h3>
              <ol className="mt-2 grid gap-2">
                {detail.decisions.map((d) => (
                  <li key={d.id} className="text-muted-foreground text-xs">
                    {utc(d.createdAt)} · {d.decidedBy} · {d.action} ·{" "}
                    <span className="font-mono">{shortHex(d.decisionHash, 6, 4)}</span>
                    {d.overrideReason ? (
                      <div className="text-foreground mt-0.5">“{d.overrideReason}”</div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
