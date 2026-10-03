"use client";

import { formatUsdc } from "@misthos/shared/money";
import { SOURCE_LABEL, type SourceType } from "@misthos/shared/sources";
import { ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { StatusBadge, type Status } from "@/components/status-badge";
import { flagLabel } from "@/lib/flags";
import { BOARD_STAGES, boardStage } from "@/lib/journey";
import { cn } from "@/lib/utils";
import type { Optimistic } from "./review-drawer";

// The drawer (and its evidence views) only loads when a row is opened.
const ReviewDrawer = dynamic(() => import("./review-drawer").then((m) => m.ReviewDrawer), {
  ssr: false,
});

export interface ReviewRow {
  id: string;
  url: string;
  sourceType: SourceType;
  status: Status;
  amount: string | null;
  createdAt: string;
  xHandle: string;
  summary: string | null;
  flags: { code: string; severity: string }[];
}

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

function Amount({ r, size = "md" }: { r: ReviewRow; size?: "md" | "sm" }) {
  if (!r.amount || r.amount === "0")
    return <span className="text-muted-foreground text-sm">—</span>;
  return (
    <span className={cn("display tabular-nums", size === "md" ? "text-2xl" : "text-xl")}>
      {formatUsdc(BigInt(r.amount), { withSymbol: false })}
      <span className="text-muted-foreground ml-1 font-sans text-xs">USDC</span>
    </span>
  );
}

/**
 * The owner's submissions as calm rows (list) or grouped by stage (board). Either opens the same drawer, and a
 * decision made there shows at once (optimistic), then gives way to the signed record when it lands.
 */
export function ReviewTable({
  rows,
  maxPerPayout,
  view = "list",
}: {
  rows: ReviewRow[];
  maxPerPayout: string;
  view?: "list" | "board";
}) {
  const [open, setOpenState] = useState<string | null>(null);
  const [everOpened, setEverOpened] = useState(false);
  const setOpen = (id: string | null) => {
    if (id) setEverOpened(true);
    setOpenState(id);
  };
  // Each decision remembers the status it was made against, so fresh server data takes over once it arrives.
  const [pending, setPending] = useState<Record<string, Optimistic & { from: Status }>>({});
  const shown = rows.map((row) => {
    const o = pending[row.id]?.from === row.status ? pending[row.id] : undefined;
    return o
      ? {
          ...row,
          status: o.status,
          amount: o.amount ? String(Math.round(Number(o.amount) * 1e6)) : row.amount,
          summary: "Your decision is being signed…",
        }
      : row;
  });

  if (rows.length === 0)
    return <p className="text-muted-foreground mt-3 text-sm">No submissions match this filter.</p>;

  const rowProps = (r: ReviewRow) => ({
    tabIndex: 0,
    role: "button" as const,
    "aria-label": `Review submission by @${r.xHandle}`,
    onClick: () => setOpen(r.id),
    onKeyDown: (e: React.KeyboardEvent) =>
      (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(r.id)),
  });

  return (
    <>
      {view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="grid min-w-[60rem] grid-cols-5 gap-3">
            {BOARD_STAGES.map((stage) => {
              const items = shown.filter((r) => boardStage(r.status) === stage.key);
              return (
                <section
                  key={stage.key}
                  aria-label={`${stage.label}: ${items.length}`}
                  className="bg-muted/50 rounded-[1.25rem] p-2.5"
                >
                  <h3 className="flex items-center justify-between px-2 pt-1 pb-3 text-sm font-medium">
                    {stage.label}
                    <span className="bg-card text-muted-foreground rounded-full px-2 py-0.5 text-xs tabular-nums">
                      {items.length}
                    </span>
                  </h3>
                  <ul className="grid gap-2.5">
                    {items.map((r) => (
                      <li key={`${r.id}-${r.status}`}>
                        <div
                          {...rowProps(r)}
                          className="bg-card shadow-soft hover:shadow-lift animate-in fade-in slide-in-from-bottom-1 grid cursor-pointer gap-2 rounded-2xl p-3.5 transition-shadow duration-300"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">@{r.xHandle}</span>
                            <span className="text-muted-foreground shrink-0 text-xs">
                              {SOURCE_LABEL[r.sourceType]}
                            </span>
                          </div>
                          <p className="text-soft line-clamp-2 text-[13px] leading-relaxed">
                            {r.summary ?? (r.status === "processing" ? "Reviewing…" : "Queued")}
                          </p>
                          <Amount r={r} size="sm" />
                        </div>
                      </li>
                    ))}
                    {items.length === 0 ? (
                      <li className="text-muted-foreground px-2 pb-2 text-xs">Nothing here.</li>
                    ) : null}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <ul className="bg-card shadow-soft divide-border/70 divide-y overflow-hidden rounded-[1.25rem]">
          {shown.map((r) => (
            <li key={r.id}>
              <div
                {...rowProps(r)}
                className="hover:bg-muted/40 grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 px-5 py-4 transition-colors sm:grid-cols-[8.5rem_minmax(0,1fr)_auto_auto]"
              >
                <span className="hidden sm:block">
                  <StatusBadge status={r.status} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                    <span className="sm:hidden">
                      <StatusBadge status={r.status} />
                    </span>
                    <span className="font-medium">@{r.xHandle}</span>
                    <span className="text-muted-foreground">{SOURCE_LABEL[r.sourceType]}</span>
                    <span className="text-muted-foreground text-xs">{when(r.createdAt)}</span>
                  </div>
                  <p className="text-soft mt-1 line-clamp-1 text-[13px]">
                    {r.summary ?? (r.status === "processing" ? "Reviewing…" : "Queued")}
                  </p>
                  {r.flags.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <span
                          key={f.code}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px]",
                            f.severity === "hard"
                              ? "bg-danger-subtle text-danger"
                              : "bg-warning-subtle text-warning",
                          )}
                        >
                          {flagLabel(f.code)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <Amount r={r} />
                <ChevronRight
                  className="text-muted-foreground hidden size-4 sm:block"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {everOpened ? (
        <ReviewDrawer
          submissionId={open}
          onClose={() => setOpen(null)}
          maxPerPayout={maxPerPayout}
          onOptimistic={(id, o) =>
            setPending((p) => {
              const next = { ...p };
              const from = rows.find((x) => x.id === id)?.status;
              if (o && from) next[id] = { ...o, from };
              else delete next[id];
              return next;
            })
          }
        />
      ) : null}
    </>
  );
}
