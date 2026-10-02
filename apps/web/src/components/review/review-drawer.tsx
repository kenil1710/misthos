"use client";

import { formatUsdc, shortHex } from "@misthos/shared";
import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { HexValue } from "@/components/hex-value";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";
import { Term } from "@/components/ui-kit/term";
import { EVIDENCE_LABELS, flagLabel } from "@/lib/flags";
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
      if (res.status === 401) {
        setError("Your session expired. Sign in again, then retry; your reason is kept below.");
        toast.error("Your session expired. Sign in again to continue.");
        return;
      }
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        setError(body.error ?? "Couldn't save the decision.");
        toast.error(body.error ?? "Couldn't save the decision.");
      } else {
        setWaitingFor(detail.decisions.length);
        toast.success(action === "approve" ? `Approved ${amount} USDC` : "Rejected", {
          description: "The agent is signing your decision. The contributor sees your reason.",
        });
      }
    } catch {
      setError("Couldn't reach Misthos. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  const [confirming, setConfirming] = useState<"approve" | "reject" | null>(null);

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
              <details className="group mt-3">
                <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs">
                  Decision details
                </summary>
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
                  <dt className="text-muted-foreground">
                    <Term k="decisionHash">Decision hash</Term>
                  </dt>
                  <dd>
                    <HexValue value={latest.decisionHash} label="decision hash" />
                  </dd>
                  <dt className="text-muted-foreground">Rules</dt>
                  <dd className="font-mono">{latest.ruleVersion}</dd>
                  {latest.promptVersion ? (
                    <>
                      <dt className="text-muted-foreground">Prompt</dt>
                      <dd className="font-mono">{latest.promptVersion}</dd>
                    </>
                  ) : null}
                  {latest.model ? (
                    <>
                      <dt className="text-muted-foreground">Model</dt>
                      <dd className="font-mono break-words">{latest.model}</dd>
                    </>
                  ) : null}
                </dl>
              </details>
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${f.severity === "hard" ? "bg-danger-subtle text-danger" : "bg-warning-subtle text-warning"}`}
                      >
                        {flagLabel(f.code)}
                      </span>
                      <span className="text-muted-foreground font-mono text-[11px]">{f.code}</span>
                    </div>
                    <p className="mt-1.5">{f.message}</p>
                    <dl className="text-muted-foreground mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                      {Object.entries(f.evidence)
                        .filter(([, v]) => v !== null && v !== false && v !== "")
                        .map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt>{EVIDENCE_LABELS[k] ?? k}</dt>
                            <dd
                              className={
                                typeof v === "string" && /^0x[0-9a-fA-F]{16,}$/.test(v)
                                  ? "[overflow-wrap:anywhere]"
                                  : "break-words"
                              }
                            >
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
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {agent?.llm ? (
            <section>
              <h3 className="font-medium">
                Scores{" "}
                <span className="text-muted-foreground font-normal">({agent.categoryKey})</span>
              </h3>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1">
                {Object.entries(agent.llm.rubric_scores).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="capitalize">{k.replace(/_/g, " ")}</dt>
                    <dd className="font-mono tabular-nums">{v}/10</dd>
                  </div>
                ))}
                <dt className="text-muted-foreground border-t pt-1">Points</dt>
                <dd className="border-t pt-1 font-mono tabular-nums">{agent.points}</dd>
                <dt className="text-muted-foreground">Agent confidence</dt>
                <dd className="font-mono tabular-nums">
                  {Math.round(agent.llm.confidence * 100)}%
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
                <Label htmlFor="ov-reason">Reason</Label>
                <Textarea
                  id="ov-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-describedby="ov-reason-help"
                />
                <p id="ov-reason-help" className="text-muted-foreground text-xs">
                  {reasonOk
                    ? "Saved with the signed decision and shown to the contributor."
                    : `At least 10 characters (${reason.trim().length}/10). Saved with the signed decision and shown to the contributor.`}
                </p>
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
                  onClick={() => setConfirming("approve")}
                >
                  {agent && amount && toDecimal(agent.amount) !== amount && agent.amount !== "0"
                    ? "Adjust and approve"
                    : "Approve"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !reasonOk || waitingFor !== null}
                  onClick={() => setConfirming("reject")}
                >
                  Reject
                </Button>
              </div>
            </section>
          ) : null}

          {decided ? (
            <ConfirmDialog
              open={confirming !== null}
              onOpenChange={(o) => !o && setConfirming(null)}
              title={
                confirming === "approve" ? `Approve ${amount} USDC?` : "Reject this submission?"
              }
              description={
                confirming === "approve"
                  ? "It's paid when the round closes, within the vault limits."
                  : "The contributor sees your reason. You can change this decision until the round pays."
              }
              rows={[
                ...(confirming === "approve"
                  ? [{ label: "Amount", value: `${amount} USDC`, mono: true }]
                  : []),
                ...(agent
                  ? [
                      {
                        label: "Agent recommended",
                        value: agent.amount !== "0" ? `${toDecimal(agent.amount)} USDC` : "Nothing",
                        mono: true,
                      },
                    ]
                  : []),
                {
                  label: "Reason",
                  value: <span className="line-clamp-3 text-left">{reason}</span>,
                },
              ]}
              confirmLabel={confirming === "approve" ? "Approve" : "Reject"}
              destructive={confirming === "reject"}
              onConfirm={() => confirming && void override(confirming)}
            />
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
