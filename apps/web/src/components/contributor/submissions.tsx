"use client";

import { classifySubmissionUrl } from "@misthos/shared/submission-url";
import { formatUsdc } from "@misthos/shared/money";
import { listSources, SOURCE_LABEL, SOURCE_LABELS, type SourceType } from "@misthos/shared/sources";
import { ChevronDown, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { StatusBadge, type Status } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { decisionChanged } from "@/lib/contributor-live";
import { fixesFor } from "@/lib/flags";
import { contradictions, submissionJourney, type JourneyStep } from "@/lib/journey";
import type { SubmissionItem } from "@/lib/server/contributor-submissions";
import { cn } from "@/lib/utils";
import { JourneyStepper } from "@/components/review/reasoning";

type Item = Omit<SubmissionItem, "status"> & { status: Status };

const IN_FLIGHT: Status[] = ["pending", "processing"];
const singular = (t: SourceType) => SOURCE_LABEL[t];

export function Submissions({
  programSlug,
  acceptedSources,
  roundNumber,
  roundEndsAt,
  verifyBase,
  initial,
}: {
  programSlug: string;
  acceptedSources: SourceType[];
  roundNumber: number | null;
  roundEndsAt: string | null;
  verifyBase: string;
  /** Rendered on the server, so the list is there on first paint (no loading flash). */
  initial: Item[];
}) {
  const [items, setItems] = useState<Item[] | null>(initial);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const router = useRouter();

  const fetchItems = useCallback(
    async (ids?: string[]): Promise<Item[] | null> => {
      const q = new URLSearchParams({ program: programSlug });
      if (ids) q.set("ids", ids.join(","));
      const res = await fetch(`/api/contributor/submissions?${q}`, { cache: "no-store" });
      if (res.status === 401) {
        setExpired(true);
        return null;
      }
      return res.ok ? ((await res.json()) as { submissions: Item[] }).submissions : null;
    },
    [programSlug],
  );

  // Poll only the items still being reviewed: quickly at first, then backing off (2s → 15s). Paused while the tab
  // is hidden, and stopped once every decision is final.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const inFlightIds = (items ?? [])
    .filter((i) => IN_FLIGHT.includes(i.status) && !i.id.startsWith("temp-"))
    .map((i) => i.id)
    .join(",");
  useEffect(() => {
    if (!inFlightIds) return;
    let delay = 2000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.hidden) return; // resumed by visibilitychange
      const fresh = await fetchItems(inFlightIds.split(","));
      if (stopped) return;
      if (fresh) {
        // A decision landed: the timeline, "You're in" and the totals are server-rendered; refresh them too.
        if (decisionChanged(itemsRef.current ?? [], fresh)) router.refresh();
        setItems((prev) => (prev ?? []).map((i) => fresh.find((f) => f.id === i.id) ?? i));
      }
      delay = Math.min(Math.round(delay * 1.6), 15_000);
      timer = setTimeout(tick, delay);
    };
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        delay = 2000;
        void tick();
      }
    };
    timer = setTimeout(tick, delay);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [inFlightIds, fetchItems, router]);

  const hint = useMemo(() => {
    if (!url.trim()) return null;
    const c = classifySubmissionUrl(url);
    if (!c.ok) return { ok: false, text: c.error };
    if (!acceptedSources.includes(c.sourceType))
      return {
        ok: false,
        text: `This program doesn't pay for ${SOURCE_LABELS[c.sourceType]}.`,
      };
    return {
      ok: true,
      text: `Looks like ${singular(c.sourceType).toLowerCase().replace(/^x /, "an X ")}.`,
    };
  }, [url, acceptedSources]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!hint?.ok || busy) return;
    const c = classifySubmissionUrl(url);
    if (!c.ok) return;
    // Optimistic: the item shows up as queued right away; replaced by the real one (or removed on failure).
    const tempId = `temp-${Date.now()}`;
    const submitted = url;
    setItems((prev) => [
      {
        id: tempId,
        url: c.canonicalUrl,
        sourceType: c.sourceType,
        status: "pending",
        amount: null,
        createdAt: new Date().toISOString(),
        decision: null,
        round: null,
        payout: null,
        appeal: null,
      },
      ...(prev ?? []),
    ]);
    setUrl("");
    setBusy(true);
    setError(null);
    const undo = () => {
      setItems((prev) => (prev ?? []).filter((i) => i.id !== tempId));
      setUrl(submitted);
    };
    try {
      const res = await fetch("/api/contributor/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programSlug, url }),
      });
      if (res.status === 401) {
        undo();
        setExpired(true);
        return;
      }
      const body = (await res.json()) as { ok: boolean; error?: string; submissionId?: string };
      if (!body.ok || !body.submissionId) {
        undo();
        setError(body.error ?? "Couldn't submit that link.");
        return;
      }
      setItems((prev) =>
        (prev ?? []).map((i) => (i.id === tempId ? { ...i, id: body.submissionId! } : i)),
      );
      setJustSubmitted(true);
      toast.success("Submitted. The agent is reviewing it.");
      // "You're in" gives way to the timeline, which now starts with this submission.
      router.refresh();
    } catch {
      undo();
      setError("Couldn't reach Misthos. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const accepts = listSources(acceptedSources);

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
        <label htmlFor="submit-url" className="display text-[1.5rem] leading-tight">
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
          className="bg-brand-subtle/60 relative rounded-[1.25rem] p-5 text-sm"
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
                ? ` when Round ${roundNumber} closes on ${roundEndsAt.slice(0, 10)}`
                : " when the round closes"}
              .
            </li>
          </ol>
        </section>
      ) : null}

      <div className="min-w-0">
        <h2 className="display text-[1.5rem] leading-tight">Your submissions</h2>
        {items === null ? (
          <div className="mt-3 grid gap-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground mt-3 rounded-[1.25rem] border border-dashed px-4 py-10 text-center text-sm">
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

const SEGMENT: Record<JourneyStep["state"], string> = {
  done: "bg-brand",
  current: "bg-brand/45 animate-pulse [animation-duration:2.4s]",
  failed: "bg-danger",
  skipped: "bg-muted",
  waiting: "bg-muted",
};

/** Where a submission stands: the last step that happened (or is happening), in the contributor's words. */
function whereItIs(steps: JourneyStep[]): JourneyStep {
  return (
    steps.find((s) => s.state === "failed") ??
    steps.find((s) => s.state === "current") ??
    [...steps].reverse().find((s) => s.state === "done") ??
    steps[0]!
  );
}

/**
 * One submission as a journey card: status and amount, the link, the agent's reason, a segmented track of the
 * seven steps (submitted → paid) with where it is now, how to fix a rejection, and the full journey on demand.
 */
function SubmissionItem({ i, verifyBase }: { i: Item; verifyBase: string }) {
  const [open, setOpen] = useState(false);
  const paidish = i.status === "approved" || i.status === "partial" || i.status === "paid";
  const fixes =
    i.status === "rejected" || i.status === "escalated" ? fixesFor(i.decision?.flags ?? []) : [];
  // Every contradicted claim; decisions made before rules-v7 didn't always list them in the summary.
  const factsNotInSummary = contradictions(i.decision?.flags ?? []).filter(
    (f) => !i.decision?.summary.includes(f),
  );
  const steps = submissionJourney({
    status: i.status,
    createdAt: i.createdAt,
    decision: i.decision
      ? {
          action: i.decision.action,
          amount: i.decision.amount,
          createdAt: i.decision.createdAt,
          flags: i.decision.flags,
          scored: i.decision.scored,
          decidedBy: i.decision.decidedBy,
        }
      : null,
    round: i.round,
    payout: i.payout,
  });
  const now = whereItIs(steps);
  const journeyId = `journey-${i.id}`;
  return (
    <li className="bg-card shadow-soft min-w-0 overflow-hidden rounded-[1.25rem] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge status={i.status} />
          <span className="text-muted-foreground text-xs whitespace-nowrap">
            {singular(i.sourceType)}
          </span>
        </div>
        {i.amount && i.amount !== "0" && paidish ? (
          <span className="display shrink-0 text-[1.5rem] leading-none tabular-nums">
            {formatUsdc(BigInt(i.amount), { withSymbol: false })}
            <span className="text-muted-foreground ml-1 font-sans text-xs">USDC</span>
          </span>
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

      <div className="mt-4">
        <div className="flex gap-1" aria-hidden="true">
          {steps.map((s) => (
            <span key={s.key} className={cn("h-1.5 flex-1 rounded-full", SEGMENT[s.state])} />
          ))}
        </div>
        <p
          className={cn(
            "mt-2 text-xs font-medium",
            now.state === "failed" ? "text-danger" : "text-foreground",
          )}
        >
          <span className="sr-only">Where it is: </span>
          {now.label}
          {i.status === "pending" || i.status === "processing" ? (
            <span className="text-muted-foreground font-normal">
              {" "}
              ·{" "}
              {i.status === "processing"
                ? "the agent is reviewing it now"
                : "usually under a minute"}
            </span>
          ) : null}
        </p>
      </div>

      {i.decision ? (
        <p className="mt-3 text-sm leading-relaxed">{keepDatesTogether(i.decision.summary)}</p>
      ) : null}
      {factsNotInSummary.length ? (
        <div className="bg-warning-subtle mt-3 rounded-xl px-3.5 py-2.5 text-sm">
          <p className="font-medium">
            {factsNotInSummary.length === 1
              ? "1 claim conflicts with the program's brief"
              : `${factsNotInSummary.length} claims conflict with the program's brief`}
          </p>
          <ul className="text-soft mt-1 grid list-disc gap-0.5 pl-4">
            {factsNotInSummary.map((f, idx) => (
              <li key={`${idx}-${f}`}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {fixes.length ? (
        <div className="bg-muted/60 mt-3 rounded-xl px-3.5 py-2.5 text-sm">
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

      <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={journeyId}
          onClick={() => setOpen((o) => !o)}
          className="hover:text-foreground inline-flex items-center gap-1 rounded-sm font-medium"
        >
          Full journey
          <ChevronDown
            className={cn("size-3.5 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        {i.decision ? (
          <>
            <span>
              {i.decision.decidedBy === "human"
                ? "Reviewed by the program team"
                : "Decided by the agent"}
            </span>
            <Link
              href={`${verifyBase}#verify?d=${i.decision.decisionHash}`}
              className="text-foreground underline underline-offset-4"
              title={i.decision.decisionHash}
            >
              Verify this decision
            </Link>
          </>
        ) : null}
      </div>
      {open ? (
        <div id={journeyId} className="mt-4">
          <JourneyStepper steps={steps} audience="contributor" />
        </div>
      ) : null}
      <SecondLook i={i} />
    </li>
  );
}

/**
 * "Ask for a second look" at a rejected or partly paid decision: once per submission, a short note for the team.
 * The answer is the team's own signed decision.
 */
function SecondLook({ i }: { i: Item }) {
  const [asked, setAsked] = useState(i.appeal);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible =
    !!i.decision &&
    (i.decision.action === "reject" || i.decision.action === "partial") &&
    !i.payout;
  if (asked)
    return (
      <p className="text-muted-foreground mt-3 text-xs">
        {asked.resolvedAt
          ? "The team took a second look; the decision above is theirs."
          : "Second look requested. The team will review it and sign their decision."}
      </p>
    );
  if (!eligible) return null;
  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contributor/submissions/${i.id}/appeal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !out.ok) return setError(out.error ?? "Couldn't send it. Try again.");
      setAsked({ createdAt: new Date().toISOString(), resolvedAt: null });
      toast.success("Sent. The team will take a second look.");
    } catch {
      setError("Couldn't reach Misthos. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-foreground mt-3 text-xs font-medium underline underline-offset-4"
      >
        Ask for a second look
      </button>
    );
  const id = `appeal-${i.id}`;
  return (
    <div className="mt-3 grid gap-2">
      <label htmlFor={id} className="text-xs font-medium">
        Why should the team look again? (once per submission)
      </label>
      <textarea
        id={id}
        maxLength={280}
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3"
        placeholder="It's my own thread from the round; the second post links the repo."
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs tabular-nums">{note.length}/280</span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={busy || !note.trim()} onClick={send}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Dates like 2026-10-12 shouldn't wrap at their hyphens: use non-breaking hyphens for display. */
function keepDatesTogether(text: string) {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$1\u2011$2\u2011$3");
}
