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
import { CloseRoundNow } from "@/components/vault/round-actions";
import { getProgramForMember } from "@/lib/server/queries";
import { listRounds } from "@/lib/server/rounds-view";
import { getOwnerSession } from "@/lib/server/session";

export const metadata = { title: "Rounds" };

export default async function RoundsPage({ params }: PageProps<"/app/programs/[id]/rounds">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  const row = await getProgramForMember(id, session.sub);
  if (!row) return null;
  const rounds = await listRounds(id);
  const open = rounds.find((r) => r.status === "open");
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Rounds</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            When a round closes, the agent re-checks approved work, totals it per contributor within
            the vault limits, proposes the payouts on-chain, and executes them (or waits for your
            approval above the threshold).
          </p>
        </div>
        {open && row.role === "owner" && row.program.vaultAddress ? (
          <CloseRoundNow roundId={open.id} />
        ) : null}
      </div>
      {!row.program.vaultAddress ? (
        <p className="bg-warning-subtle text-warning rounded-md p-3 text-sm">
          Deploy and fund the vault (Overview) before rounds can pay out.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Round</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Payouts</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rounds.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/app/programs/${id}/rounds/${r.id}`}
                    className="font-medium hover:underline"
                  >
                    Round {r.number}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {r.startsAt.toISOString().slice(0, 10)} → {r.endsAt.toISOString().slice(0, 10)}
                </TableCell>
                <TableCell>
                  <RoundStatus status={r.status} />
                  {r.status === "open" && r.approvedUnpaid ? (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {r.approvedUnpaid} approved
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.payouts}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.totalAmount > 0n ? formatUsdc(r.totalAmount, { withSymbol: false }) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
