import { formatUsdc } from "@misthos/shared/money";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { NeedItem, ProgramSummary } from "@/lib/server/program-summary";
import { roundPhrase } from "@/lib/status-line";
import { cn } from "@/lib/utils";
import { ProgramStatus } from "./program-status";

const SETUP_TEXT = {
  deploy: "Next: deploy the vault",
  fund: "Next: fund the vault",
  publish: "Next: publish the join page",
} as const;

/** What the owner has to act on, first thing on the page; a calm "all caught up" when there's nothing. */
export function NeedsYou({
  items,
  showProgram,
  programNames,
}: {
  items: (NeedItem & { programId?: string })[];
  showProgram?: boolean;
  programNames?: Record<string, string>;
}) {
  return (
    <section aria-labelledby="needs-h" className="bg-card rounded-xl border">
      <h2 id="needs-h" className="border-b px-5 py-3.5 text-base font-medium sm:px-6">
        Needs you
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 px-5 py-4 text-sm sm:px-6">
          <CheckCircle2 className="text-success size-4" strokeWidth={1.75} aria-hidden="true" />
          You&apos;re all caught up.
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((n, i) => (
            <li
              key={`${n.href}-${i}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 sm:px-6"
            >
              <span className="min-w-0 text-sm">
                {showProgram && n.programId && programNames?.[n.programId] ? (
                  <span className="text-muted-foreground">{programNames[n.programId]}: </span>
                ) : null}
                {n.text}.
              </span>
              <Button
                asChild
                size="sm"
                variant={n.kind === "review" || n.kind === "approval" ? "default" : "outline"}
              >
                <Link href={n.href}>{n.action}</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A program on the all-programs page: status, round countdown, what's waiting, and the numbers that matter. */
export function ProgramCard({ s }: { s: ProgramSummary }) {
  const p = s.program;
  const href = `/app/programs/${p.id}`;
  const round = p.status === "draft" ? null : roundPhrase(s.round).join(" · ");
  return (
    <article className="bg-card hover:border-foreground/20 relative flex flex-col rounded-xl border p-5 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">
            <Link href={href} className="after:absolute after:inset-0 after:rounded-xl">
              {p.name}
            </Link>
          </h3>
          <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">/{p.slug}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {s.needs.length ? (
            <span className="bg-warning-subtle text-warning inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium">
              Needs you · {s.needs.length}
            </span>
          ) : null}
          <ProgramStatus status={p.status} />
        </div>
      </div>
      <p className="text-soft mt-3 text-sm">{s.setupNext ? SETUP_TEXT[s.setupNext] : round}</p>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t pt-4 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">Waiting</dt>
          <dd className={cn("mono-num mt-0.5", s.waitingReview && "text-warning")}>
            {s.waitingReview}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Contributors</dt>
          <dd className="mono-num mt-0.5">{s.contributors}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Vault</dt>
          <dd className="mono-num mt-0.5">
            {s.vault ? formatUsdc(s.vault.balance, { withSymbol: false }) : "—"}
          </dd>
        </div>
      </dl>
      <div className="relative mt-4 flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">
          {s.readyToPay > 0n ? `${formatUsdc(s.readyToPay)} ready to pay` : "Nothing to pay yet"}
        </span>
        <Button asChild size="sm" variant="outline">
          <Link href={href}>Open</Link>
        </Button>
      </div>
    </article>
  );
}

/** A small, faithful preview of the public join page: what a contributor sees first. */
export function JoinPagePreview({
  name,
  description,
  categories,
}: {
  name: string;
  description: string;
  categories: { key: string; name: string; payout: bigint }[];
}) {
  return (
    <div
      aria-label="Join page preview"
      className="bg-background rounded-lg border p-4 text-sm shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
    >
      <p className="text-muted-foreground text-xs">Contributor program</p>
      <p className="mt-0.5 font-medium">{name}</p>
      <p className="text-soft mt-1 line-clamp-2 text-xs leading-relaxed">{description}</p>
      <ul className="mt-3 grid gap-1.5">
        {categories.map((c) => (
          <li
            key={c.key}
            className="flex items-baseline justify-between gap-3 rounded-md border px-2.5 py-1.5 text-xs"
          >
            <span className="truncate">{c.name}</span>
            <span className="mono-num shrink-0">up to {formatUsdc(c.payout)}</span>
          </li>
        ))}
      </ul>
      <div className="bg-foreground text-background mt-3 rounded-md py-1.5 text-center text-xs font-medium">
        Sign in with X to join
      </div>
    </div>
  );
}
