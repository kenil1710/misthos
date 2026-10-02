import { formatUsdc, shortHex } from "@misthos/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { RoundStatus } from "@/components/app/round-status";
import { HexValue } from "@/components/hex-value";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApproveRound, CloseRoundNow } from "@/components/vault/round-actions";
import { getProgramForMember } from "@/lib/server/queries";
import { getRoundDetail, listRounds } from "@/lib/server/rounds-view";
import { Card, Notice, PageHeader, Stat } from "@/components/ui-kit";
import { Term } from "@/components/ui-kit/term";
import { utc } from "@/lib/time";
import { getOwnerSession } from "@/lib/server/session";
import { explorerAddress, explorerTx, readVault } from "@/lib/server/vault";

const ROUND_STATUS_TEXT: Record<string, string> = {
  open: "Open for submissions",
  closed: "Closing: preparing payouts",
  proposed: "Proposed on Arc",
  approved: "Approved",
  executed: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STEPS = [
  ["round.closed", "Closed"],
  ["round.planned", "Payouts planned"],
  ["round.proposed", "Proposed on-chain"],
  ["round.approved", "Approved by owner"],
  ["round.executed", "Executed"],
] as const;

export default async function RoundPage({
  params,
}: PageProps<"/app/programs/[id]/rounds/[roundId]">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id, roundId } = await params;
  if (!z.uuid().safeParse(roundId).success) notFound();
  const row = await getProgramForMember(id, session.sub);
  if (!row) notFound();
  const detail = await getRoundDetail(id, roundId);
  if (!detail) notFound();
  const { round, payouts, events } = detail;
  const vault = row.program.vaultAddress as Address | null;
  const verifyBase = row.program.status === "draft" ? null : `/p/${row.program.slug}`;
  const chain = vault ? await readVault(vault).catch(() => null) : null;
  const needsApproval =
    round.status === "proposed" && chain && round.totalAmount > chain.limits.autoApproveThreshold;
  const txFor: Record<string, string | null> = {
    "round.proposed": round.txHashPropose,
    "round.approved": round.txHashApprove,
    "round.executed": round.txHashExecute,
  };
  const openRound =
    round.status === "open" ? (await listRounds(id)).find((r) => r.id === round.id) : undefined;
  const planned = events.find((e) => e.action === "round.planned")?.data as
    { deferred?: { submissionId: string; reason: string }[] } | undefined;

  return (
    <div className="grid gap-8">
      <PageHeader
        crumbs={[
          { label: row.program.name, href: `/app/programs/${id}` },
          { label: "Rounds", href: `/app/programs/${id}/rounds` },
          { label: `Round ${round.number}` },
        ]}
        title={`Round ${round.number}`}
        meta={<RoundStatus status={round.status} />}
        description={`${utc(round.startsAt)} to ${utc(round.endsAt)}`}
        actions={
          round.status === "open" && row.role === "owner" && vault ? (
            <CloseRoundNow
              roundId={round.id}
              roundNumber={round.number}
              approvedTotal={openRound?.approvedUnpaidAmount ?? "0"}
              approvedCount={openRound?.approvedUnpaid ?? 0}
              threshold={row.program.limitsJson.autoApproveThreshold}
            />
          ) : null
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Round totals">
        <Stat
          label="Total"
          value={formatUsdc(round.totalAmount, { withSymbol: false })}
          hint="USDC"
        />
        <Stat label="Payouts" value={payouts.length} hint="one per contributor" />
        <Stat
          label="Status"
          value={
            <span className="font-sans text-base">
              {ROUND_STATUS_TEXT[round.status] ?? round.status}
            </span>
          }
        />
      </section>

      {round.lastError ? (
        <Notice tone={round.status === "failed" ? "danger" : "warning"}>
          {round.status === "failed" ? "This round failed: " : "The agent is retrying: "}
          {round.lastError}
        </Notice>
      ) : null}
      {needsApproval && row.role === "owner" && vault && round.roundIdBytes32 ? (
        <Card
          title="Your approval is needed"
          description={
            <>
              This round totals {formatUsdc(round.totalAmount)}, above the{" "}
              {formatUsdc(chain!.limits.autoApproveThreshold)} you allow without{" "}
              <Term k="approvalThreshold">approval</Term>. Check the payouts below, then approve.
              The agent sends them right after.
            </>
          }
        >
          <ApproveRound
            roundId={round.id}
            roundNumber={round.number}
            vault={vault}
            roundIdBytes32={round.roundIdBytes32 as Hex}
            owner={session.addr as Address}
            total={round.totalAmount.toString()}
            payoutCount={payouts.length}
          />
        </Card>
      ) : null}

      <section>
        <h2 className="text-base font-medium">Timeline</h2>
        <ol className="mt-3 grid gap-2 text-sm">
          {STEPS.map(([action, label]) => {
            const e = events.find((x) => x.action === action);
            const tx = txFor[action];
            return (
              <li
                key={action}
                className={`flex flex-wrap items-center gap-x-3 ${e ? "" : "text-muted-foreground"}`}
              >
                <span
                  className={`size-2 rounded-full ${e ? "bg-success" : "bg-muted-foreground/40"}`}
                  aria-hidden="true"
                />
                <span className="w-40">{label}</span>
                <span className="text-muted-foreground tabular-nums">{e ? utc(e.at) : "—"}</span>
                {tx ? (
                  <a
                    href={explorerTx(tx)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[13px] hover:underline"
                  >
                    {shortHex(tx, 6, 4)}
                  </a>
                ) : null}
              </li>
            );
          })}
        </ol>
        {round.decisionRoot ? (
          <p className="text-muted-foreground mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Term k="decisionHash">Decision root</Term>
            <HexValue value={round.decisionRoot} label="decision root" />
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="text-base font-medium">Payouts</h2>
        {payouts.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            {round.status === "open"
              ? "Payouts are planned when the round closes."
              : "Nothing to pay in this round."}
          </p>
        ) : (
          <div className="bg-card mt-3 overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contributor</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>
                    <Term k="decisionHash">Decision hash</Term>
                  </TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Transaction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>@{p.xHandle}</TableCell>
                    <TableCell>
                      <HexValue
                        value={p.toAddress}
                        label="payee wallet"
                        href={explorerAddress(p.toAddress)}
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatUsdc(p.amount, { withSymbol: false })}
                    </TableCell>
                    <TableCell>
                      <HexValue value={p.decisionHash} label="payout decision hash" />
                    </TableCell>
                    <TableCell>
                      {/* The payout hash commits to these records; each can be verified on the public page. */}
                      <div className="flex flex-wrap gap-3 text-[13px]">
                        {p.items.map((i, n) =>
                          i.decisionHash && verifyBase ? (
                            <Link
                              key={i.id}
                              href={`${verifyBase}#verify?d=${i.decisionHash}`}
                              className="underline underline-offset-4"
                            >
                              Verify{p.items.length > 1 ? ` ${n + 1}` : ""}
                            </Link>
                          ) : (
                            <span key={i.id} className="text-muted-foreground font-mono">
                              {i.decisionHash ? shortHex(i.decisionHash, 6, 4) : "—"}
                            </span>
                          ),
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.txHash ? (
                        <HexValue
                          value={p.txHash}
                          label="transaction hash"
                          href={explorerTx(p.txHash)}
                        />
                      ) : (
                        <span className="text-muted-foreground capitalize">{p.status}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {planned?.deferred?.length ? (
          <p className="text-muted-foreground mt-3 text-sm">
            {planned.deferred.length} approved item{planned.deferred.length === 1 ? "" : "s"}{" "}
            carried to the next round (
            {[...new Set(planned.deferred.map((d) => d.reason.replace(/_/g, " ")))].join(", ")}).
          </p>
        ) : null}
      </section>
    </div>
  );
}
