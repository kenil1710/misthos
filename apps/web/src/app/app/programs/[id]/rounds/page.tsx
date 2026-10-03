import { formatUsdc } from "@misthos/shared";
import Link from "next/link";
import { RoundStatus } from "@/components/app/round-status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, Notice, PageHeader, TableFrame } from "@/components/ui-kit";
import { Term } from "@/components/ui-kit/term";
import { CloseRoundNow } from "@/components/vault/close-round";
import { getProgramForMember } from "@/lib/server/queries";
import { listRounds } from "@/lib/server/rounds-view";
import { getOwnerSession } from "@/lib/server/session";
import { utcDay } from "@/lib/time";
import { isScheduled } from "@/lib/rounds";
import { fromNow } from "@/lib/when";
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
      {rounds.length === 0 ? (
        <EmptyState>The first round starts when the program does.</EmptyState>
      ) : (
        <TableFrame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Round</TableHead>
                <TableHead>Window (UTC)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Payouts</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...rounds].reverse().map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`${base}/rounds/${r.id}`} className="font-medium hover:underline">
                      Round {r.number}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {utcDay(r.startsAt)} to {utcDay(r.endsAt)}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <RoundStatus status={isScheduled(r) ? "scheduled" : r.status} />
                      {isScheduled(r) ? (
                        <span className="text-muted-foreground text-xs">
                          starts {fromNow(r.startsAt)}
                        </span>
                      ) : null}
                      {r.status === "open" && r.approvedUnpaid ? (
                        <span className="text-muted-foreground text-xs">
                          {r.approvedUnpaid} approved, {formatUsdc(BigInt(r.approvedUnpaidAmount))}
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="mono-num text-right">{r.payouts}</TableCell>
                  <TableCell className="mono-num text-right">
                    {r.totalAmount > 0n ? formatUsdc(r.totalAmount, { withSymbol: false }) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      )}
    </div>
  );
}
