"use client";

import {
  classifySubmissionUrl,
  formatUsdc,
  shortHex,
  SOURCE_LABELS,
  type SourceType,
} from "@misthos/shared";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge, type Status } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

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

export function Submissions({
  programSlug,
  acceptedSources,
}: {
  programSlug: string;
  acceptedSources: SourceType[];
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async (): Promise<Item[] | null> => {
    const res = await fetch(
      `/api/contributor/submissions?program=${encodeURIComponent(programSlug)}`,
      { cache: "no-store" },
    );
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
      if (!cancelled && next) setItems(next);
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
    return { ok: true, text: SOURCE_LABELS[c.sourceType].replace(/s$/, "") };
  }, [url, acceptedSources]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!hint?.ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contributor/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programSlug, url }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        setError(body.error ?? "Couldn't submit that link.");
        return;
      }
      setUrl("");
      await load();
    } catch {
      setError("Couldn't reach Misthos. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <form onSubmit={submit} className="grid gap-2">
        <label htmlFor="submit-url" className="text-sm font-medium">
          Submit your work
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="submit-url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://x.com/you/status/… or a GitHub PR or article link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={hint ? !hint.ok : undefined}
            aria-describedby="submit-hint"
          />
          <Button type="submit" disabled={!hint?.ok || busy}>
            {busy ? "Submitting…" : "Submit"}
          </Button>
        </div>
        <p
          id="submit-hint"
          className={`text-xs ${hint && !hint.ok ? "text-danger" : "text-muted-foreground"}`}
        >
          {hint
            ? hint.text
            : "Paste one link per submission. The agent reviews it in under a minute."}
        </p>
        {error ? (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}
      </form>

      <div>
        <h3 className="text-sm font-medium">Your submissions</h3>
        {items === null ? (
          <div className="mt-3 grid gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            Nothing yet. Submit your first link above.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3" aria-live="polite">
            {items.map((i) => (
              <li key={i.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusBadge status={i.status} />
                    <span className="text-muted-foreground text-xs">
                      {SOURCE_LABELS[i.sourceType].replace(/s$/, "")}
                    </span>
                    <a
                      href={i.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-w-0 items-center gap-1 truncate text-sm hover:underline"
                    >
                      <span className="truncate">{i.url.replace(/^https?:\/\//, "")}</span>
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    </a>
                  </div>
                  {i.amount &&
                  i.amount !== "0" &&
                  (i.status === "approved" || i.status === "partial" || i.status === "paid") ? (
                    <span className="font-mono text-sm tabular-nums">
                      {formatUsdc(BigInt(i.amount))}
                    </span>
                  ) : null}
                </div>
                {i.decision ? (
                  <>
                    <p className="mt-2 text-sm">{i.decision.summary}</p>
                    <p className="text-muted-foreground mt-2 font-mono text-[11px]">
                      Decision {shortHex(i.decision.decisionHash, 6, 4)}
                      {i.decision.decidedBy === "human" ? " · reviewed by the program team" : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground mt-2 text-sm">
                    {i.status === "processing"
                      ? "The agent is reviewing this now."
                      : "Queued for review."}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
