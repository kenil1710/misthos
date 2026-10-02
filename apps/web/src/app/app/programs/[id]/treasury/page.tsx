import { formatUsdc, shortHex } from "@misthos/shared";
import type { Address } from "viem";
import { HexValue } from "@/components/hex-value";
import { FundVault } from "@/components/vault/fund-vault";
import { getProgramForMember } from "@/lib/server/queries";
import { treasuryActivity } from "@/lib/server/rounds-view";
import { getOwnerSession } from "@/lib/server/session";
import { explorerAddress, explorerTx, readVault, usdcAddress } from "@/lib/server/vault";

export const metadata = { title: "Treasury" };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 font-mono text-xl tabular-nums">{value}</div>
      {sub ? <div className="text-muted-foreground mt-1 text-xs">{sub}</div> : null}
    </div>
  );
}

export default async function TreasuryPage({ params }: PageProps<"/app/programs/[id]/treasury">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  const row = await getProgramForMember(id, session.sub);
  if (!row) return null;
  const vault = row.program.vaultAddress as Address | null;
  if (!vault)
    return (
      <p className="text-muted-foreground text-sm">
        Deploy the vault from the Overview tab to see its treasury.
      </p>
    );
  const [state, activity] = await Promise.all([readVault(vault), treasuryActivity(id)]);
  const capPct =
    state.limits.maxPerDay > 0n
      ? Number((state.spentInWindow * 1000n) / state.limits.maxPerDay) / 10
      : 0;

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Treasury</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Read live from the vault{" "}
            <HexValue value={vault} label="vault address" href={explorerAddress(vault)} />
            {state.paused ? " · paused" : ""}
          </p>
        </div>
      </div>
      <section className="grid gap-4 sm:grid-cols-4">
        <Stat label="Balance" value={formatUsdc(state.balance)} />
        <Stat label="Deposited" value={formatUsdc(state.totalDeposited)} sub="through deposit()" />
        <Stat label="Paid out" value={formatUsdc(state.totalPaid)} />
        <Stat label="Withdrawn by owner" value={formatUsdc(state.totalWithdrawn)} />
      </section>
      <section className="rounded-lg border p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">Daily cap usage (rolling 24h)</span>
          <span className="font-mono tabular-nums">
            {formatUsdc(state.spentInWindow, { withSymbol: false })} /{" "}
            {formatUsdc(state.limits.maxPerDay)}
          </span>
        </div>
        <div
          className="bg-muted mt-3 h-2 overflow-hidden rounded-full"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={capPct}
          aria-label="Daily cap used"
        >
          <div className="bg-brand h-full" style={{ width: `${Math.min(100, capPct)}%` }} />
        </div>
      </section>
      {row.role === "owner" ? (
        <section>
          <h2 className="text-base font-medium">Add funds</h2>
          <div className="mt-3">
            <FundVault
              programId={id}
              vault={vault}
              usdc={usdcAddress()}
              owner={session.addr as Address}
            />
          </div>
        </section>
      ) : null}
      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-base font-medium">Deposits</h2>
          {activity.deposits.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              No deposits recorded from Misthos yet. Deposits made elsewhere still count in the
              totals above.
            </p>
          ) : (
            <ul className="mt-2 grid gap-1 text-sm">
              {activity.deposits.map((d) => (
                <li key={d.txHash} className="flex justify-between gap-3">
                  <a
                    href={explorerTx(d.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[13px] hover:underline"
                  >
                    {shortHex(d.txHash, 6, 4)}
                  </a>
                  <span className="text-muted-foreground tabular-nums">
                    {d.at.toISOString().slice(0, 10)}
                  </span>
                  <span className="font-mono tabular-nums">{formatUsdc(BigInt(d.amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="text-base font-medium">Payouts</h2>
          {activity.outflows.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">No payouts yet.</p>
          ) : (
            <ul className="mt-2 grid gap-1 text-sm">
              {activity.outflows.map((o, i) => (
                <li key={`${o.txHash}-${i}`} className="flex justify-between gap-3">
                  <span>
                    @{o.xHandle}{" "}
                    <span className="text-muted-foreground">· round {o.roundNumber}</span>
                  </span>
                  {o.txHash ? (
                    <a
                      href={explorerTx(o.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[13px] hover:underline"
                    >
                      {shortHex(o.txHash, 6, 4)}
                    </a>
                  ) : null}
                  <span className="font-mono tabular-nums">{formatUsdc(o.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
