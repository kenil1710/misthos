import { formatUsdc } from "@misthos/shared";
import Link from "next/link";
import { RoundStatus } from "@/components/app/round-status";
import { EmptyState, Notice, PageHeader } from "@/components/ui-kit";
import { Term } from "@/components/ui-kit/term";
import { CloseRoundNow } from "@/components/vault/close-round";
import { getProgramForMember } from "@/lib/server/queries";
import { listRounds } from "@/lib/server/rounds-view";
import { getOwnerSession } from "@/lib/server/session";
import { utcDay } from "@/lib/time";
import { isScheduled } from "@/lib/rounds";
import { fromNow, shortFromNow } from "@/lib/when";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Rounds" };

export default async function RoundsPage({ params }: PageProps<"/app/programs/[id]/rounds">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  const row = await getProgramForMember(id, session.sub);
  if (!row) return null;
  const rounds = await listRounds(id);
  const open = rounds.find((r) => r.status === "open");
  const openScheduled = open ? isScheduled(open) : false;
  const base = `/app/programs/${id}`;
  return (
    <div className="grid gap-6">
      <PageHeader
        crumbs={[{ label: row.program.name, href: base }, { label: "Rounds" }]}
        title="Rounds"
        description={
          <>
            Each <Term k="round">round</Term> pays approved work in one go. When it closes, the
            agent re-checks every item, totals it per contributor within your limits, and pays it
            (or waits for your approval above your threshold).
          </>
        }
        actions={
          open && openScheduled && row.role === "owner" ? (
            <div className="grid justify-items-end gap-1">
              <Button variant="outline" disabled>
                Close round now
              </Button>
              <p className="text-muted-foreground text-xs">
                Round {open.number} hasn&apos;t started.{" "}
                <Link
                  href={`${base}/settings#schedule`}
                  className="text-foreground underline underline-offset-4"
                >
                  Start it now
                </Link>
              </p>
            </div>
          ) : open && row.role === "owner" && row.program.vaultAddress ? (
            <CloseRoundNow
              roundId={open.id}
              roundNumber={open.number}
              approvedTotal={open.approvedUnpaidAmount}
              approvedCount={open.approvedUnpaid}
              threshold={row.program.limitsJson.autoApproveThreshold}
            />
          ) : null
        }
      />
      {!row.program.vaultAddress ? (
        <Notice>
          Rounds can&apos;t pay out until the vault is deployed and funded.{" "}
          <Link href={base} className="underline underline-offset-4">
            Finish setup
          </Link>
        </Notice>
      ) : null}
      {open && !openScheduled ? (
        <section
          aria-label={`Round ${open.number} is open`}
          className="bg-card shadow-soft grid gap-5 rounded-[1.25rem] p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-7"
        >
          <div>
            <p className="text-muted-foreground text-sm">Round {open.number} is open</p>
            <p className="display mt-1 text-[2.5rem] leading-none">
              closes in {shortFromNow(open.endsAt)}
            </p>
            <p className="text-soft mt-3 text-sm">
              {open.approvedUnpaid
                ? `${open.approvedUnpaid} approved so far, ${formatUsdc(BigInt(open.approvedUnpaidAmount))} to pay when it closes.`
                : "Nothing approved yet in this round."}
            </p>
          </div>
          <Button asChild variant="outline" className="w-fit">
            <Link href={`${base}/rounds/${open.id}`}>Open round {open.number}</Link>
          </Button>
        </section>
      ) : null}
      {rounds.length === 0 ? (
        <EmptyState art="stack" title="No rounds yet">
          The first round starts when the program does.
        </EmptyState>
      ) : (
        <ul className="bg-card shadow-soft divide-border/70 divide-y overflow-hidden rounded-[1.25rem]">
          {[...rounds].reverse().map((r) => (
            <li
              key={r.id}
              className="hover:bg-muted/40 relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 px-5 py-4 transition-colors sm:grid-cols-[7rem_minmax(0,1fr)_auto_auto]"
            >
              <Link
                href={`${base}/rounds/${r.id}`}
                className="font-medium after:absolute after:inset-0"
              >
                Round {r.number}
              </Link>
              <div className="row-start-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm sm:row-start-auto">
                <RoundStatus status={isScheduled(r) ? "scheduled" : r.status} />
                <span className="text-muted-foreground tabular-nums">
                  {utcDay(r.startsAt)} to {utcDay(r.endsAt)}
                </span>
                {isScheduled(r) ? (
                  <span className="text-muted-foreground text-xs">
                    starts {fromNow(r.startsAt)}
                  </span>
                ) : null}
              </div>
              <span className="text-muted-foreground hidden text-sm sm:block">
                {r.payouts ? `${r.payouts} payout${r.payouts === 1 ? "" : "s"}` : ""}
              </span>
              <span className="display row-span-2 text-right text-2xl tabular-nums sm:row-span-1">
                {r.totalAmount > 0n
                  ? formatUsdc(r.totalAmount, { withSymbol: false })
                  : r.status === "open" && r.approvedUnpaid
                    ? formatUsdc(BigInt(r.approvedUnpaidAmount), { withSymbol: false })
                    : "—"}
                <span className="text-muted-foreground ml-1 font-sans text-xs">
                  {r.totalAmount > 0n || (r.status === "open" && r.approvedUnpaid) ? "USDC" : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
