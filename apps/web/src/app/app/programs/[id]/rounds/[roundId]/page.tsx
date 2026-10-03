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
import { ApproveRound } from "@/components/vault/islands";
import { CoinsArt } from "@/components/brand/illustrations";
import { Stepper } from "@/components/ui-kit/stepper";
import { roundLifecycle } from "@/lib/round-lifecycle";
import { ArrowUpRight } from "lucide-react";
import { CloseRoundNow } from "@/components/vault/close-round";
import { getProgramForMember } from "@/lib/server/queries";
import { getRoundDetail, listRounds } from "@/lib/server/rounds-view";
import { Notice, PageHeader } from "@/components/ui-kit";
import { Term } from "@/components/ui-kit/term";
import { shortUtc, utc } from "@/lib/time";
import { isScheduled } from "@/lib/rounds";
import { getOwnerSession } from "@/lib/server/session";
import { explorerAddress, explorerTx, readVault } from "@/lib/server/vault";
import { programNameForTitle } from "@/lib/server/titles";

export async function generateMetadata({
  params,
}: PageProps<"/app/programs/[id]/rounds/[roundId]">) {
  const { id } = await params;
  const name = await programNameForTitle(id);
  return { title: name ? `Round · ${name}` : "Round" };
}

const ROUND_STATUS_TEXT: Record<string, string> = {
  open: "Open for submissions",
  scheduled: "Scheduled",
  closed: "Closed: preparing payouts",
  proposed: "Proposed on Arc",
  approved: "Approved",
  executed: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
};

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
  // Only a proposed round can need the owner's approval, so only then is the vault read (an RPC call).
  const chain =
    vault && round.status === "proposed" ? await readVault(vault).catch(() => null) : null;
  const needsApproval =
    round.status === "proposed" && chain && round.totalAmount > chain.limits.autoApproveThreshold;
  const openRound =
    round.status === "open" ? (await listRounds(id)).find((r) => r.id === round.id) : undefined;
  const nothingToPay = events.some((e) => e.action === "round.nothing_to_pay");
  const lifecycle = roundLifecycle({
    ...round,
    scheduled: isScheduled(round),
    events,
    needsApproval: !!needsApproval,
    nothingToPay,
  });
  const planned = events.find((e) => e.action === "round.planned")?.data as
    { deferred?: { submissionId: string; reason: string }[] } | undefined;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <PageHeader
        crumbs={[
          { label: row.program.name, href: `/app/programs/${id}` },
          { label: "Rounds", href: `/app/programs/${id}/rounds` },
          { label: `Round ${round.number}` },
        ]}
        title={`Round ${round.number}`}
        meta={<RoundStatus status={isScheduled(round) ? "scheduled" : round.status} />}
        description={`${utc(round.startsAt)} to ${utc(round.endsAt)}`}
        actions={
          round.status === "open" && !isScheduled(round) && row.role === "owner" && vault ? (
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

      {round.status === "executed" && !nothingToPay ? (
        <section
          aria-label="Round paid"
          className="bg-brand-subtle relative overflow-hidden rounded-[1.5rem] p-6 sm:p-8"
        >
          <CoinsArt className="pointer-events-none absolute -right-2 -bottom-4 hidden size-40 sm:block animate-in slide-in-from-top-3 fade-in fill-mode-both delay-300 duration-1000" />
          <p className="text-brand text-sm font-medium">Paid on Arc</p>
          <p className="display text-brand mt-1 text-[3rem] leading-none tabular-nums sm:text-[4rem]">
            {formatUsdc(round.totalAmount, { withSymbol: false })}
            <span className="ml-2 font-sans text-lg">USDC</span>
          </p>
          <p className="text-soft mt-3 text-sm">
            to {payouts.length} contributor{payouts.length === 1 ? "" : "s"}
            {round.executedAt ? ` · ${utc(round.executedAt)}` : ""}
          </p>
          {round.txHashExecute ? (
            <a
              href={explorerTx(round.txHashExecute)}
              target="_blank"
              rel="noreferrer"
              className="text-brand mt-4 inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
            >
              View the transaction{" "}
              <span className="font-mono">{shortHex(round.txHashExecute, 6, 4)}</span>
              <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
            </a>
          ) : null}
        </section>
      ) : null}

      <section
        aria-labelledby="life-h"
        className="bg-card shadow-soft rounded-[1.25rem] p-5 sm:p-7"
      >
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="life-h" className="text-lg font-medium">
            Where this round is
          </h2>
          <p className="text-muted-foreground text-sm">
            {nothingToPay
              ? "Closed: nothing to pay"
              : (ROUND_STATUS_TEXT[round.status] ?? round.status)}
            {" · "}
            <span className="tabular-nums">{formatUsdc(round.totalAmount)}</span> in{" "}
            {payouts.length} payout
            {payouts.length === 1 ? "" : "s"}
          </p>
        </div>
        <Stepper
          orientation="responsive"
          label="Round progress"
          steps={lifecycle.map((st) => ({
            key: st.key,
            label: st.label,
            status: st.state,
            meta: st.meta ?? (st.at ? shortUtc(st.at) : undefined),
            detail: st.txHash ? (
              <a
                href={explorerTx(st.txHash)}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline-offset-4 hover:underline"
              >
                {shortHex(st.txHash, 6, 4)}
              </a>
            ) : (
              st.detail
            ),
          }))}
        />
        {needsApproval && row.role === "owner" && vault && round.roundIdBytes32 ? (
          <div className="bg-warning-subtle/60 mt-6 grid gap-3 rounded-2xl p-5">
            <p className="text-sm leading-relaxed">
              This round totals {formatUsdc(round.totalAmount)}, above the{" "}
              {formatUsdc(chain!.limits.autoApproveThreshold)} you allow without{" "}
              <Term k="approvalThreshold">approval</Term>. Check the payouts below, then approve.
              The agent sends them right after.
            </p>
            <ApproveRound
              roundId={round.id}
              roundNumber={round.number}
              vault={vault}
              roundIdBytes32={round.roundIdBytes32 as Hex}
              owner={session.addr as Address}
              total={round.totalAmount.toString()}
              payoutCount={payouts.length}
            />
          </div>
        ) : null}
        {round.decisionRoot ? (
          <p className="text-muted-foreground mt-5 flex flex-wrap items-center gap-2 text-xs">
            <Term k="decisionHash">Decision root</Term>
            <HexValue value={round.decisionRoot} label="decision root" />
          </p>
        ) : null}
      </section>

      {round.lastError ? (
        <Notice tone={round.status === "failed" ? "danger" : "warning"}>
          {round.status === "failed" ? "This round failed: " : "The agent is retrying: "}
          {round.lastError}
        </Notice>
      ) : null}
      <section>
        <h2 className="text-lg font-medium">Payouts</h2>
        {payouts.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            {round.status === "open"
              ? "Payouts are planned when the round closes."
              : "Nothing to pay in this round."}
          </p>
        ) : (
          <div className="bg-card shadow-soft mt-3 overflow-x-auto rounded-[1.25rem] px-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contributor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Transaction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">@{p.xHandle}</div>
                      <HexValue
                        value={p.toAddress}
                        label="payee wallet"
                        href={explorerAddress(p.toAddress)}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsdc(p.amount, { withSymbol: false })}
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
