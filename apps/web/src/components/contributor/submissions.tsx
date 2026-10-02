"use client";

import { classifySubmissionUrl, formatUsdc, SOURCE_LABELS, type SourceType } from "@misthos/shared";
import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { StatusBadge, type Status } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FLAG_COPY } from "@/lib/flags";

interface Item {
  id: string;
  url: string;
  sourceType: SourceType;
  status: Status;
  amount: string | null;
  createdAt: string;
  decision: {
    summary: string;
    decisionHash: string;
    decidedBy: "agent" | "human";
    flags: { code: string; severity: string }[];
  } | null;
}

const IN_FLIGHT: Status[] = ["pending", "processing"];
const singular = (t: SourceType) => SOURCE_LABELS[t].replace(/s$/, "");

export function Submissions({
  programSlug,
  acceptedSources,
  roundNumber,
  roundEndsAt,
  verifyBase,
}: {
  programSlug: string;
  acceptedSources: SourceType[];
  roundNumber: number | null;
  roundEndsAt: string | null;
  verifyBase: string;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const fetchItems = useCallback(async (): Promise<Item[] | null> => {
    const res = await fetch(
      `/api/contributor/submissions?program=${encodeURIComponent(programSlug)}`,
      {
        cache: "no-store",
      },
    );
    if (res.status === 401) {
      setExpired(true);
      return null;
    }
    return res.ok ? ((await res.json()) as { submissions: Item[] }).submissions : null;
  }, [programSlug]);
  const load = useCallback(async () => {
    const next = await fetchItems();
    if (next) setItems(next);
  }, [fetchItems]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await fetchItems();
      if (!cancelled) setItems(next ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchItems]);

  // Poll only while something is still being reviewed.
  const inFlight = items?.some((i) => IN_FLIGHT.includes(i.status)) ?? false;
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [inFlight, load]);

  const hint = useMemo(() => {
    if (!url.trim()) return null;
    const c = classifySubmissionUrl(url);
    if (!c.ok) return { ok: false, text: c.error };
    if (!acceptedSources.includes(c.sourceType))
      return {
        ok: false,
        text: `This program doesn't pay for ${SOURCE_LABELS[c.sourceType].toLowerCase()}.`,
      };
    return {
      ok: true,
      text: `Looks like ${singular(c.sourceType).toLowerCase().replace(/^x /, "an X ")}.`,
    };
  }, [url, acceptedSources]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!hint?.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contributor/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programSlug, url }),
      });
      if (res.status === 401) {
        setExpired(true);
        return;
      }
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        setError(body.error ?? "Couldn't submit that link.");
        return;
      }
      setUrl("");
      setJustSubmitted(true);
      toast.success("Submitted. The agent is reviewing it.");
      await load();
    } catch {
      setError("Couldn't reach Misthos. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const accepts = acceptedSources
    .map((t) => SOURCE_LABELS[t].replace(/^(?!X )./, (c) => c.toLowerCase()))
    .join(", ");

  return (
    <div className="grid min-w-0 gap-6">
      {expired ? (
        <div
          role="alert"
          className="bg-warning-subtle text-warning flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm"
        >
          <span className="flex-1">
            Your session expired. Sign in with X again to keep submitting.
          </span>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/auth/x/start?next=${encodeURIComponent(`/c/${programSlug}`)}`}>
              Sign in with X
            </a>
          </Button>
        </div>
      ) : null}
      <form onSubmit={submit} className="grid min-w-0 gap-2">
        <label htmlFor="submit-url" className="font-medium">
          Submit your work
        </label>
        <p className="text-muted-foreground text-sm">
          This program pays for {accepts}. One link per submission.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="submit-url"
            inputMode="url"
            autoComplete="off"
            placeholder="Paste a link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={hint ? !hint.ok : undefined}
            aria-describedby="submit-hint"
            className="h-10 sm:h-9"
          />
          <Button type="submit" disabled={!hint?.ok || busy} className="h-10 sm:h-9">
            {busy ? "Submitting…" : "Submit"}
          </Button>
        </div>
        <p
          id="submit-hint"
          className={`text-xs ${hint && !hint.ok ? "text-danger" : "text-muted-foreground"}`}
        >
          {hint ? hint.text : "The agent reviews it in about a minute and tells you why."}
        </p>
        {error ? (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}
      </form>

      {justSubmitted ? (
        <section
          aria-label="What happens next"
          className="bg-muted/40 relative rounded-lg border p-4 text-sm"
        >
          <button
            type="button"
            onClick={() => setJustSubmitted(false)}
            className="text-muted-foreground hover:text-foreground absolute top-3 right-3 rounded-sm"
            aria-label="Dismiss"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
          <p className="font-medium">What happens next</p>
          <ol className="text-soft mt-2 grid list-decimal gap-1 pl-4">
            <li>
              The agent checks it&apos;s yours, original and inside the round, then scores it. About
              a minute.
            </li>
            <li>
              You&apos;ll see the decision and the reason below. Some submissions go to the team for
              a second look.
            </li>
            <li>
              Approved work is paid in USDC to your wallet
              {roundNumber && roundEndsAt
                ? ` when round ${roundNumber} closes on ${roundEndsAt.slice(0, 10)}`
                : " when the round closes"}
              .
            </li>
          </ol>
        </section>
      ) : null}

      <div className="min-w-0">
        <h2 className="font-medium">Your submissions</h2>
        {items === null ? (
          <div className="mt-3 grid gap-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground mt-3 rounded-lg border border-dashed px-4 py-8 text-center text-sm">
            Nothing yet. Paste a link to your first piece of work above.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3" aria-live="polite">
            {items.map((i) => (
              <SubmissionItem key={i.id} i={i} verifyBase={verifyBase} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SubmissionItem({ i, verifyBase }: { i: Item; verifyBase: string }) {
  const paidish = i.status === "approved" || i.status === "partial" || i.status === "paid";
  const fixes =
    i.status === "rejected" || i.status === "escalated"
      ? [...new Set((i.decision?.flags ?? []).map((f) => FLAG_COPY[f.code]?.fix).filter(Boolean))]
      : [];
  return (
    <li className="bg-card min-w-0 overflow-hidden rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge status={i.status} />
          <span className="text-muted-foreground text-xs whitespace-nowrap">
            {singular(i.sourceType)}
          </span>
        </div>
        {i.amount && i.amount !== "0" && paidish ? (
          <span className="mono-num shrink-0 text-sm">{formatUsdc(BigInt(i.amount))}</span>
        ) : null}
      </div>
      <a
        href={i.url}
        target="_blank"
        rel="noreferrer"
        className="text-soft hover:text-foreground mt-2 flex min-w-0 items-center gap-1 text-sm"
      >
        <span className="truncate">{i.url.replace(/^https?:\/\//, "")}</span>
        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
      </a>
      {i.decision ? (
        <>
          <p className="mt-2 text-sm leading-relaxed">{i.decision.summary}</p>
          {fixes.length ? (
            <div className="bg-muted/50 mt-3 rounded-md px-3 py-2 text-sm">
              <p className="font-medium">
                {i.status === "rejected" ? "How to get paid next time" : "Why it's being reviewed"}
              </p>
              <ul className="text-soft mt-1 grid list-disc gap-0.5 pl-4">
                {fixes.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {i.decision.decidedBy === "human" ? (
              <span>Reviewed by the program team</span>
            ) : (
              <span>Decided by the agent</span>
            )}
            <Link
              href={`${verifyBase}#verify?d=${i.decision.decisionHash}`}
              className="text-foreground underline underline-offset-4"
              title={i.decision.decisionHash}
            >
              Verify this decision
            </Link>
          </p>
        </>
      ) : (
        <p className="text-muted-foreground mt-2 text-sm">
          {i.status === "processing"
            ? "The agent is reviewing this now."
            : "Queued for review. Usually under a minute."}
        </p>
      )}
    </li>
  );
}
