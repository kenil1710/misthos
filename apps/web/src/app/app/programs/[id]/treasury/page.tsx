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
import { Card, EmptyState, PageHeader, TableFrame } from "@/components/ui-kit";
import { VaultArt } from "@/components/brand/illustrations";
import { Term } from "@/components/ui-kit/term";
import { FundVault, PauseVault, WithdrawVault } from "@/components/vault/islands";
import { getProgramForMember } from "@/lib/server/queries";
import { treasuryActivity } from "@/lib/server/rounds-view";
import { getOwnerSession } from "@/lib/server/session";
import { utcDay } from "@/lib/time";
import { explorerAddress, explorerTx, readVaultShared, usdcAddress } from "@/lib/server/vault";

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
        <EmptyState
          art="vault"
          title="No vault yet"
          action={{ label: "Deploy the vault", href: `${base}/setup` }}
        >
          Deploy the vault to see its treasury: balance, deposits and payouts.
        </EmptyState>
      </div>
    );
  const [state, activity] = await Promise.all([readVaultShared(vault), treasuryActivity(id)]);
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
            Read from the <Term k="vault">vault</Term> on Arc (at most 15 seconds old).
            <span className="mt-1 block">
              <HexValue value={vault} label="vault address" href={explorerAddress(vault)} />
            </span>
          </>
        }
      />
      <section
        aria-label="Vault totals"
        className="bg-card shadow-soft relative overflow-hidden rounded-[1.5rem] p-6 sm:p-8"
      >
        <VaultArt className="pointer-events-none absolute top-1/2 right-8 hidden size-40 -translate-y-1/2 md:block" />
        <div className="relative md:pr-44">
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            Balance
            {state.paused ? (
              <span className="bg-warning-subtle text-warning rounded-full px-2 py-0.5 text-xs">
                Paused
              </span>
            ) : null}
          </p>
          <p className="display mt-1 text-[3.25rem] leading-none tabular-nums sm:text-[4rem]">
            {formatUsdc(state.balance, { withSymbol: false })}
            <span className="text-muted-foreground ml-2 font-sans text-lg">USDC</span>
          </p>
          <p className="text-soft mt-2 text-sm">
            {state.paused ? "Payouts are paused." : "Available for payouts."}
          </p>
          <dl className="mt-7 grid grid-cols-1 gap-4 border-t pt-5 sm:grid-cols-3">
            {(
              [
                ["Deposited", state.totalDeposited],
                ["Paid to contributors", state.totalPaid],
                ["Withdrawn by you", state.totalWithdrawn],
              ] as const
            ).map(([label, v]) => (
              <div key={label}>
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="display mt-0.5 text-2xl tabular-nums">
                  {formatUsdc(v, { withSymbol: false })}
                  <span className="text-muted-foreground ml-1 font-sans text-xs">USDC</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
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
            className={`${capPct >= 80 ? "bg-warning" : "bg-brand"} h-full rounded-full`}
            style={{ width: `${Math.min(100, capPct)}%` }}
          />
        </div>
        {capPct >= 80 ? (
          <p className="text-warning mt-3 text-sm">
            Only {formatUsdc(state.limits.maxPerDay - state.spentInWindow)} left in this window.
            Approved work that doesn&apos;t fit is carried to a later round. To pay more now, raise
            the limit in{" "}
            <Link href={`${base}/settings`} className="underline underline-offset-4">
              Settings
            </Link>
            .
          </p>
        ) : null}
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
          <h2 className="text-lg font-medium">Deposits</h2>
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
                    <TableHead className="text-right">Amount (USDC)</TableHead>
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
          <h2 className="text-lg font-medium">Payouts</h2>
          {activity.outflows.length === 0 ? (
            <EmptyState art="coins" title="No payouts yet">
              They appear here after the first round pays.
            </EmptyState>
          ) : (
            <TableFrame>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contributor</TableHead>
                    <TableHead>Transaction</TableHead>
                    <TableHead className="text-right">Amount (USDC)</TableHead>
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
