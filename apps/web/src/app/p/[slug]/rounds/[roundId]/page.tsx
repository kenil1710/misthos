import { formatUsdc } from "@misthos/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { EmptyState, Section, Stat, TableFrame } from "@/components/ui-kit";
import { getPublicProgram, publicPayouts, publicRounds } from "@/lib/server/public";
import { explorerAddress, explorerTx } from "@/lib/server/vault";

export const metadata: Metadata = { title: "Round receipt" };

export default async function RoundReceipt({ params }: PageProps<"/p/[slug]/rounds/[roundId]">) {
  const { slug, roundId } = await params;
  if (!z.uuid().safeParse(roundId).success) notFound();
  const program = await getPublicProgram(slug);
  if (!program) notFound();
  const round = (await publicRounds(program.id)).find((r) => r.id === roundId);
  if (!round) notFound();
  const payouts = await publicPayouts(program.id, round.id);
  const txs = [
    ["Proposed by the agent", round.txHashPropose],
    ["Approved by the owner", round.txHashApprove],
    ["Executed by the agent", round.txHashExecute],
  ] as const;

  return (
    <>
      <header className="grid gap-2">
        <Link href={`/p/${program.slug}`} className="text-muted-foreground text-sm hover:underline">
          {program.name}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Round {round.number} receipt</h1>
          <RoundStatus status={round.status} />
        </div>
        <p className="text-muted-foreground mono-num text-sm">
          {round.startsAt.toISOString().slice(0, 16).replace("T", " ")} to{" "}
          {round.endsAt.toISOString().slice(0, 16).replace("T", " ")} UTC
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Total paid"
          value={formatUsdc(round.status === "executed" ? round.totalAmount : 0n, {
            withSymbol: false,
          })}
          hint="USDC on Arc"
        />
        <Stat label="Payouts" value={payouts.length} />
        <Stat
          label="Vault"
          value={
            program.vaultAddress ? (
              <HexValue
                value={program.vaultAddress}
                label="vault"
                href={explorerAddress(program.vaultAddress)}
              />
            ) : (
              "—"
            )
          }
        />
      </section>

      <Section
        title="On-chain record"
        description="The round commits to the hash of every decision it pays (the decision root)."
      >
        <dl className="grid gap-x-8 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-[220px_1fr]">
          {txs.map(([label, hash]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>
                {hash ? (
                  <HexValue value={hash} label={label} href={explorerTx(hash)} />
                ) : (
                  <span className="text-muted-foreground">
                    {label.startsWith("Approved")
                      ? "Not required (under the approval threshold)"
                      : "Not yet"}
                  </span>
                )}
              </dd>
            </div>
          ))}
          <dt className="text-muted-foreground">Decision root</dt>
          <dd>
            {round.decisionRoot ? (
              <HexValue value={round.decisionRoot} label="decision root" />
            ) : (
              <span className="text-muted-foreground">Set when the round is proposed</span>
            )}
          </dd>
        </dl>
      </Section>

      <Section title="Payouts">
        {payouts.length === 0 ? (
          <EmptyState>
            {round.status === "open"
              ? "This round is still open. Payouts are prepared when it closes."
              : "No payouts in this round."}
          </EmptyState>
        ) : (
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contributor</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Decision records</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.id} className="align-top">
                    <TableCell>@{p.handle}</TableCell>
                    <TableCell>
                      <HexValue value={p.to} label="wallet" href={explorerAddress(p.to)} />
                    </TableCell>
                    <TableCell className="mono-num text-right">
                      {formatUsdc(p.amount, { withSymbol: false })}
                    </TableCell>
                    <TableCell>
                      <ul className="grid gap-1">
                        {p.items.map((i) => (
                          <li
                            key={i.submissionId}
                            className="flex flex-wrap items-center gap-3 text-[13px]"
                          >
                            {i.decisionHash ? (
                              <HexValue value={i.decisionHash} label="decision hash" />
                            ) : null}
                            {i.decisionHash ? (
                              <Link
                                href={`/p/${program.slug}#verify?d=${i.decisionHash}`}
                                className="underline-offset-4 hover:underline"
                              >
                                Verify
                              </Link>
                            ) : null}
                            <a
                              href={i.url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline underline-offset-4"
                            >
                              Work
                            </a>
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        )}
      </Section>
    </>
  );
}
