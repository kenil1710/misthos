import { formatUsdc } from "@misthos/shared";
import Link from "next/link";
import type { Address } from "viem";
import { HexValue } from "@/components/hex-value";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, EmptyState, PageHeader, Stat, TableFrame } from "@/components/ui-kit";
import { Term } from "@/components/ui-kit/term";
import { FundVault } from "@/components/vault/fund-vault";
import { PauseVault, WithdrawVault } from "@/components/vault/vault-controls";
import { getProgramForMember } from "@/lib/server/queries";
import { treasuryActivity } from "@/lib/server/rounds-view";
import { getOwnerSession } from "@/lib/server/session";
import { utcDay } from "@/lib/time";
import { explorerAddress, explorerTx, readVault, usdcAddress } from "@/lib/server/vault";

export const metadata = { title: "Treasury" };

export default async function TreasuryPage({ params }: PageProps<"/app/programs/[id]/treasury">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  const row = await getProgramForMember(id, session.sub);
  if (!row) return null;
  const base = `/app/programs/${id}`;
  const crumbs = [{ label: row.program.name, href: base }, { label: "Treasury" }];
  const vault = row.program.vaultAddress as Address | null;
  if (!vault)
    return (
      <div className="grid gap-6">
        <PageHeader
          crumbs={crumbs}
          title="Treasury"
          description="The program's vault, its balance and every movement of funds."
        />
        <EmptyState action={{ label: "Finish setup", href: base }}>
          Deploy the vault from the program overview to see its treasury.
        </EmptyState>
      </div>
    );
  const [state, activity] = await Promise.all([readVault(vault), treasuryActivity(id)]);
  const capPct =
    state.limits.maxPerDay > 0n
      ? Number((state.spentInWindow * 1000n) / state.limits.maxPerDay) / 10
      : 0;
  const owner = row.role === "owner";
  const me = session.addr as Address;

  return (
    <div className="grid gap-8">
      <PageHeader
        crumbs={crumbs}
        title="Treasury"
        description={
          <>
            Read live from the <Term k="vault">vault</Term> on Arc:{" "}
            <HexValue value={vault} label="vault address" href={explorerAddress(vault)} />
          </>
        }
      />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Vault totals">
        <Stat
          label="Balance"
          value={formatUsdc(state.balance, { withSymbol: false })}
          hint={state.paused ? "USDC · vault paused" : "USDC available for payouts"}
        />
        <Stat
          label="Deposited"
          value={formatUsdc(state.totalDeposited, { withSymbol: false })}
          hint="USDC, all time"
        />
        <Stat
          label="Paid to contributors"
          value={formatUsdc(state.totalPaid, { withSymbol: false })}
          hint="USDC, all time"
        />
        <Stat
          label="Withdrawn by you"
          value={formatUsdc(state.totalWithdrawn, { withSymbol: false })}
          hint="USDC, all time"
        />
      </section>

      <Card
        title="Rolling 24-hour limit"
        description="Payouts in the last 24 hours count against this cap. It frees up as older payouts age out."
      >
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">{capPct.toFixed(0)}% used</span>
          <span className="mono-num">
            {formatUsdc(state.spentInWindow, { withSymbol: false })} of{" "}
            {formatUsdc(state.limits.maxPerDay)}
          </span>
        </div>
        <div
          className="bg-muted mt-3 h-2 overflow-hidden rounded-full"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={capPct}
          aria-label="Rolling 24-hour limit used"
        >
          <div
            className="bg-brand h-full rounded-full"
            style={{ width: `${Math.min(100, capPct)}%` }}
          />
        </div>
      </Card>

      {owner ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card title="Add funds" description="Deposit USDC from your wallet.">
            <FundVault programId={id} vault={vault} usdc={usdcAddress()} owner={me} />
          </Card>
          <Card
            id="vault-controls"
            title="Withdraw or pause"
            description="You can take funds out at any time, even while paused. Pausing stops every payout until you resume."
          >
            <div className="grid gap-6">
              <WithdrawVault
                programId={id}
                vault={vault}
                owner={me}
                balance={state.balance.toString()}
              />
              <div className="border-t pt-5">
                <p className="mb-3 text-sm">
                  {state.paused ? "The vault is paused." : "Payouts are running normally."}
                </p>
                <PauseVault programId={id} vault={vault} owner={me} paused={state.paused} />
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="grid gap-3">
          <h2 className="text-base font-medium">Deposits</h2>
          {activity.deposits.length === 0 ? (
            <EmptyState>
              No deposits recorded from Misthos yet. Deposits made elsewhere still count in the
              totals.
            </EmptyState>
          ) : (
            <TableFrame>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date (UTC)</TableHead>
                    <TableHead>Transaction</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activity.deposits.map((d) => (
                    <TableRow key={d.txHash}>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {utcDay(d.at)}
                      </TableCell>
                      <TableCell>
                        <HexValue
                          value={d.txHash}
                          label="deposit transaction"
                          href={explorerTx(d.txHash)}
                        />
                      </TableCell>
                      <TableCell className="mono-num text-right">
                        {formatUsdc(BigInt(d.amount), { withSymbol: false })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
          )}
        </section>
        <section className="grid gap-3">
          <h2 className="text-base font-medium">Payouts</h2>
          {activity.outflows.length === 0 ? (
            <EmptyState>No payouts yet. They appear here after the first round pays.</EmptyState>
          ) : (
            <TableFrame>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contributor</TableHead>
                    <TableHead>Transaction</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activity.outflows.map((o, i) => (
                    <TableRow key={`${o.txHash}-${i}`}>
                      <TableCell>
                        @{o.xHandle}
                        <span className="text-muted-foreground block text-xs">
                          Round {o.roundNumber}
                        </span>
                      </TableCell>
                      <TableCell>
                        {o.txHash ? (
                          <HexValue
                            value={o.txHash}
                            label="payout transaction"
                            href={explorerTx(o.txHash)}
                          />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="mono-num text-right">
                        {formatUsdc(o.amount, { withSymbol: false })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
          )}
          <p className="text-muted-foreground text-xs">
            Full history with every decision is in the{" "}
            <Link href={`${base}/audit`} className="underline underline-offset-4">
              audit log
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
