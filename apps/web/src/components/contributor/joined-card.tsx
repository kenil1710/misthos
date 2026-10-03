import { formatUsdc } from "@misthos/shared/money";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { JoinedProgram } from "@/lib/server/joined";
import { roundPhrase } from "@/lib/status-line";

/** A program someone joined: the round and its countdown, what's waiting or approved, and what they've earned. */
export function JoinedCard({ j }: { j: JoinedProgram }) {
  const href = `/c/${j.program.slug}`;
  return (
    <article className="bg-card hover:border-foreground/20 relative flex flex-col rounded-xl border p-5 transition-colors">
      <h3 className="truncate font-medium">
        <Link href={href} className="after:absolute after:inset-0 after:rounded-xl">
          {j.program.name}
        </Link>
      </h3>
      <p className="text-soft mt-1 text-sm">{roundPhrase(j.round).join(" · ")}</p>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t pt-4 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">Waiting</dt>
          <dd className="mono-num mt-0.5">{j.waiting}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Approved</dt>
          <dd className="mono-num mt-0.5">
            {j.approved ? formatUsdc(j.approvedAmount, { withSymbol: false }) : "0"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Earned</dt>
          <dd className="mono-num mt-0.5">{formatUsdc(j.earned, { withSymbol: false })}</dd>
        </div>
      </dl>
      <div className="relative mt-4 flex justify-end">
        <Button asChild size="sm" variant="outline">
          <Link href={href}>Open</Link>
        </Button>
      </div>
    </article>
  );
}
