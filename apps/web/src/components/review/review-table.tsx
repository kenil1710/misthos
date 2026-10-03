"use client";

import { formatUsdc } from "@misthos/shared/money";
import { SOURCE_LABEL, type SourceType } from "@misthos/shared/sources";
import { useState } from "react";
import { StatusBadge, type Status } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { flagLabel } from "@/lib/flags";
import dynamic from "next/dynamic";
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

export function ReviewTable({ rows, maxPerPayout }: { rows: ReviewRow[]; maxPerPayout: string }) {
  const [open, setOpenState] = useState<string | null>(null);
  const [everOpened, setEverOpened] = useState(false);
  const setOpen = (id: string | null) => {
    if (id) setEverOpened(true);
    setOpenState(id);
  };
  // Decisions made in the drawer show here at once, before the signed record lands and the page refreshes.
  // Each one remembers the status it was made against, so fresh server data takes over once it arrives.
  const [pending, setPending] = useState<Record<string, Optimistic & { from: Status }>>({});
  if (rows.length === 0)
    return <p className="text-muted-foreground mt-3 text-sm">No submissions match this filter.</p>;
  return (
    <>
      <div className="mt-3 overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Contributor</TableHead>
              <TableHead className="min-w-[320px]">Agent decision</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const o = pending[row.id]?.from === row.status ? pending[row.id] : undefined;
              const r = o
                ? {
                    ...row,
                    status: o.status,
                    amount: o.amount ? String(Math.round(Number(o.amount) * 1e6)) : row.amount,
                  }
                : row;
              return (
                <TableRow
                  key={r.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Review submission by @${r.xHandle}`}
                  onClick={() => setOpen(r.id)}
                  onKeyDown={(e) =>
                    (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(r.id))
                  }
                  className="cursor-pointer"
                >
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    <div>@{r.xHandle}</div>
                    <div className="text-muted-foreground text-xs">
                      {SOURCE_LABEL[r.sourceType]}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[480px] text-sm whitespace-normal">
                    {o
                      ? "Your decision is being signed…"
                      : (r.summary ?? (r.status === "processing" ? "Reviewing…" : "Queued"))}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[260px] flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <span
                          key={f.code}
                          title={f.code}
                          className={`rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap ${f.severity === "hard" ? "bg-danger-subtle text-danger" : "bg-warning-subtle text-warning"}`}
                        >
                          {flagLabel(f.code)}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {r.amount && r.amount !== "0"
                      ? formatUsdc(BigInt(r.amount), { withSymbol: false })
                      : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
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
