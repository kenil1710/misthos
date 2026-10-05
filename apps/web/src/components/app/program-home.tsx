import { formatUsdc } from "@misthos/shared/money";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  MessageSquareQuote,
  Stamp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { NeedItem, ProgramSummary } from "@/lib/server/program-summary";
import { SOURCE_LABEL, type SourceType } from "@misthos/shared/sources";
import { StatusBadge, type Status } from "@/components/status-badge";
import { roundPhrase } from "@/lib/status-line";
import { fromNow } from "@/lib/when";
import { cn } from "@/lib/utils";
import { ProgramStatus } from "./program-status";

const SETUP_TEXT = {
  deploy: "Next: deploy the vault",
  fund: "Next: fund the vault",
  publish: "Next: publish the join page",
} as const;

const NEED_ICON: Record<NeedItem["kind"], typeof Inbox> = {
  review: Inbox,
  approval: Stamp,
  payee: AlertTriangle,
  low_balance: Wallet,
  appeal: MessageSquareQuote,
};

/** What the owner has to act on, first thing on the page, as cards; a calm "all caught up" when there's nothing. */
export function NeedsYou({
  items,
  showProgram,
  programNames,
}: {
  items: (NeedItem & { programId?: string })[];
  showProgram?: boolean;
  programNames?: Record<string, string>;
}) {
  const label = (n: { programId?: string }) =>
    showProgram && n.programId ? programNames?.[n.programId] : undefined;
  return (
    <section aria-labelledby="needs-h" className="grid gap-3">
      <h2 id="needs-h" className="text-lg font-medium">
        Needs you
      </h2>
      {items.length === 0 ? (
        <p className="bg-card/60 text-muted-foreground flex items-center gap-2 rounded-2xl px-5 py-4 text-sm">
          <CheckCircle2 className="text-success size-4" strokeWidth={1.75} aria-hidden="true" />
          You&apos;re all caught up.
        </p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.slice(0, NEEDS_SHOWN).map((n, i) => (
              <NeedCard key={`${n.href}-${i}`} n={n} label={label(n)} />
            ))}
          </ul>
          {items.length > NEEDS_SHOWN ? (
            // Many programs can need many things; the program cards below shouldn't sink under them.
            <details className="group">
              <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-sm underline-offset-4 hover:underline">
                Show {items.length - NEEDS_SHOWN} more
              </summary>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {items.slice(NEEDS_SHOWN).map((n, i) => (
                  <NeedCard key={`${n.href}-more-${i}`} n={n} label={label(n)} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Show this many "Needs you" items; the rest fold behind "Show N more". */
const NEEDS_SHOWN = 6;

function NeedCard({ n, label }: { n: NeedItem; label?: string }) {
  const Icon = NEED_ICON[n.kind];
  const strong = n.kind === "review" || n.kind === "approval" || n.kind === "appeal";
  return (
    <li className="bg-card shadow-soft flex flex-col justify-between gap-4 rounded-[1.25rem] p-5">
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            n.kind === "payee"
              ? "bg-danger-subtle text-danger"
              : strong
                ? "bg-warning-subtle text-warning"
                : "bg-brand-subtle text-brand",
          )}
        >
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <p className="min-w-0 pt-1.5 text-sm leading-relaxed">
          {label ? <span className="text-muted-foreground">{label}: </span> : null}
          {n.text}.
        </p>
      </div>
      <Button asChild size="sm" variant={strong ? "default" : "outline"} className="w-fit">
        <Link href={n.href}>{n.action}</Link>
      </Button>
    </li>
  );
}

/** A program on the all-programs page: status, round countdown, what's waiting, and the numbers that matter. */
export function ProgramCard({ s }: { s: ProgramSummary }) {
  const p = s.program;
  const href = `/app/programs/${p.id}`;
  const round = p.status === "draft" ? null : roundPhrase(s.round).join(" · ");
  return (
    <article className="bg-card shadow-soft hover:shadow-lift relative flex flex-col rounded-[1.25rem] p-6 transition-shadow">
      {/* Badges above the name, so a name is never cut short to make room for them. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ProgramStatus status={p.status} />
        {s.needs.length ? (
          <span className="bg-warning-subtle text-warning inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium">
            Needs you · {s.needs.length}
          </span>
        ) : null}
      </div>
      <h3 className="mt-3 line-clamp-2 font-medium break-words">
        <Link href={href} className="after:absolute after:inset-0 after:rounded-[1.25rem]">
          {p.name}
        </Link>
      </h3>
      <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">/{p.slug}</p>
      <p className="text-soft mt-3 text-sm">{s.setupNext ? SETUP_TEXT[s.setupNext] : round}</p>
      <dl className="mt-5 grid grid-cols-3 gap-3 border-t pt-4 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">Needs review</dt>
          <dd className={cn("mono-num mt-0.5", s.waitingReview && "text-warning")}>
            {s.waitingReview}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Contributors</dt>
          <dd className="mono-num mt-0.5">{s.contributors}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Vault (USDC)</dt>
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
      className="bg-background shadow-soft rounded-2xl p-5 text-sm"
    >
      <p className="text-muted-foreground text-xs">Contributor program</p>
      <p className="mt-0.5 font-medium">{name}</p>
      <p className="text-soft mt-1 line-clamp-2 text-xs leading-relaxed">{description}</p>
      <ul className="mt-3 grid gap-1.5">
        {categories.map((c) => (
          <li
            key={c.key}
            className="bg-card flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-xs"
          >
            <span className="truncate">{c.name}</span>
            <span className="mono-num shrink-0">up to {formatUsdc(c.payout)}</span>
          </li>
        ))}
      </ul>
      <div className="bg-primary text-primary-foreground mt-3 rounded-lg py-2 text-center text-xs font-medium">
        Sign in with X to join
      </div>
    </div>
  );
}

export interface RecentDecision {
  submissionId: string;
  status: string;
  sourceType: SourceType;
  xHandle: string;
  action: string;
  amount: bigint;
  summary: string;
  decidedBy: "agent" | "human";
  createdAt: Date;
}

/** The latest decisions as short cards: who, what was decided, how much, and the one-line why. */
export function RecentDecisions({ items, href }: { items: RecentDecision[]; href: string }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="recent-h" className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="recent-h" className="text-lg font-medium">
          Recent decisions
        </h2>
        <Link
          href={href}
          className="text-soft hover:text-foreground text-sm underline-offset-4 hover:underline"
        >
          All submissions
        </Link>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((d) => {
          const approved = d.action === "approve" || d.action === "partial";
          return (
            <li
              key={d.submissionId}
              className="bg-card shadow-soft grid gap-3 rounded-[1.25rem] p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm">
                  <span className="font-medium">@{d.xHandle}</span>
                  <span className="text-muted-foreground"> · {SOURCE_LABEL[d.sourceType]}</span>
                </span>
                <StatusBadge status={d.status as Status} />
              </div>
              <p className="text-soft line-clamp-2 text-[13px] leading-relaxed">{d.summary}</p>
              <div className="flex items-baseline justify-between gap-3">
                {/* Only paid or payable work has an amount; a lone dash reads like missing data. */}
                {approved ? (
                  <span className="display text-2xl tabular-nums">
                    {formatUsdc(d.amount, { withSymbol: false })}
                    <span className="text-muted-foreground ml-1 font-sans text-xs">USDC</span>
                  </span>
                ) : (
                  <span />
                )}
                <span className="text-muted-foreground text-xs">
                  {d.decidedBy === "human" ? "You decided" : "Agent"} · {fromNow(d.createdAt)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
