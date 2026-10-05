import { formatUsdc } from "@misthos/shared/money";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { JoinedProgram } from "@/lib/server/joined";
import { isScheduled } from "@/lib/rounds";
import { roundPhrase } from "@/lib/status-line";

/** A program someone joined: the round and its countdown, their submissions by outcome, and what they've earned. */
export function JoinedCard({ j }: { j: JoinedProgram }) {
  const href = `/c/${j.program.slug}`;
  const open = !!j.round && j.round.status === "open" && !isScheduled(j.round);
  return (
    <article className="bg-card shadow-soft hover:shadow-lift relative flex flex-col rounded-[1.5rem] p-6 transition-shadow">
      <h2 className="display truncate text-[1.625rem] leading-tight">
        <Link href={href} className="after:absolute after:inset-0 after:rounded-[1.5rem]">
          {j.program.name}
        </Link>
      </h2>
      <p className="text-soft mt-2 flex items-center gap-2 text-sm">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${open ? "bg-brand" : "bg-muted-foreground/50"}`}
        />
        {roundPhrase(j.round).join(" · ")}
      </p>
      <div className="mt-6">
        <p className="text-muted-foreground text-xs">Earned</p>
        <p className="display text-[2.5rem] leading-none tabular-nums">
          {formatUsdc(j.earned, { withSymbol: false })}
          <span className="text-muted-foreground ml-1.5 font-sans text-xs">USDC</span>
        </p>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 border-t pt-4 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">Submitted</dt>
          <dd className="mono-num mt-0.5">{j.submitted}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">In review</dt>
          <dd className="mono-num mt-0.5">{j.inReview}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Approved, not paid yet</dt>
          <dd className="mono-num mt-0.5">
            {j.approved ? (
              <>
                {j.approved}
                <span className="text-muted-foreground font-sans text-xs">
                  {" "}
                  · {formatUsdc(j.approvedAmount)}
                </span>
              </>
            ) : (
              "0"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Paid</dt>
          <dd className="mono-num mt-0.5">{j.paid}</dd>
        </div>
      </dl>
      <div className="relative mt-5 flex justify-end">
        <Link
          href={href}
          className="text-brand inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          Open
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
