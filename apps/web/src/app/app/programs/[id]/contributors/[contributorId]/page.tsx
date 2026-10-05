import { formatUsdc, shortHex, SOURCE_LABEL } from "@misthos/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { HexValue } from "@/components/hex-value";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, PageHeader, Section, Stat } from "@/components/ui-kit";
import { contributorDetail } from "@/lib/server/contributors-view";
import { getProgramForMember } from "@/lib/server/queries";
import { getOwnerSession } from "@/lib/server/session";
import { explorerAddress, explorerTx } from "@/lib/server/vault";
import { programNameForTitle } from "@/lib/server/titles";

export async function generateMetadata({
  params,
}: PageProps<"/app/programs/[id]/contributors/[contributorId]">) {
  const name = await programNameForTitle((await params).id);
  return { title: name ? `Contributor · ${name}` : "Contributor" };
}

const EVENT_LABEL: Record<string, string> = {
  "contributor.joined": "Joined and verified wallet",
  "contributor.wallet_verified": "Re-verified wallet",
  "contributor.wallet_changed": "Changed payout wallet",
  "payee.registered": "Registered as payee in the vault",
  "payee.changed": "Payee wallet updated in the vault (cooldown restarted)",
};

export default async function ContributorPage({
  params,
}: PageProps<"/app/programs/[id]/contributors/[contributorId]">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id, contributorId } = await params;
  if (!z.uuid().safeParse(contributorId).success) notFound();
  const row = await getProgramForMember(id, session.sub);
  if (!row) notFound();
  const d = await contributorDetail(id, contributorId);
  if (!d) notFound();
  const { contributor: c } = d;
  const earned = d.payouts
    .filter((p) => p.p.status === "executed")
    .reduce((s, p) => s + p.p.amount, 0n);
  const pending = d.submissions
    .filter((s) => (s.status === "approved" || s.status === "partial") && !s.payoutId)
    .reduce((sum, s) => sum + (s.amount ?? 0n), 0n);

  return (
    <div className="grid gap-8">
      <div>
        <PageHeader
          crumbs={[
            { label: row.program.name, href: `/app/programs/${id}` },
            { label: "Contributors", href: `/app/programs/${id}/contributors` },
            { label: `@${c.xHandle}` },
          ]}
          title={`@${c.xHandle}`}
          description={`Joined ${c.createdAt.toISOString().slice(0, 10)}${c.githubLogin ? `, GitHub ${c.githubLogin}` : ""}`}
        />
      </div>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Earned" value={formatUsdc(earned, { withSymbol: false })} hint="USDC paid" />
        <Stat label="Approved, not yet paid" value={formatUsdc(pending, { withSymbol: false })} />
        <Stat label="Submissions" value={d.submissions.length} />
        <Stat
          label="Payout wallet"
          value={
            c.walletAddress ? (
              <HexValue
                value={c.walletAddress}
                label="wallet"
                href={explorerAddress(c.walletAddress)}
              />
            ) : (
              "Not linked"
            )
          }
        />
      </section>

      <Section title="Submissions">
        {d.submissions.length === 0 ? (
          <EmptyState art="rubric">No submissions yet.</EmptyState>
        ) : (
          <ul className="bg-card divide-y rounded-lg border">
            {d.submissions.map((s) => (
              <li key={s.id} className="grid gap-1 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <StatusBadge status={s.status} />
                  <span className="text-muted-foreground">{SOURCE_LABEL[s.sourceType]}</span>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate hover:underline"
                  >
                    {s.url.replace(/^https?:\/\//, "")}
                  </a>
                  <span className="mono-num ml-auto">
                    {s.amount && s.amount > 0n ? formatUsdc(s.amount) : ""}
                  </span>
                </div>
                {s.decision ? <p>{s.decision.summary}</p> : null}
                {s.decision ? (
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {shortHex(s.decision.hash, 8, 6)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Payouts">
          {d.payouts.length === 0 ? (
            <EmptyState>No payouts yet.</EmptyState>
          ) : (
            <ul className="bg-card divide-y rounded-lg border text-sm">
              {d.payouts.map(({ p, roundNumber, roundId }) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <Link href={`/app/programs/${id}/rounds/${roundId}`} className="hover:underline">
                    Round {roundNumber}
                  </Link>
                  {p.txHash ? (
                    <HexValue value={p.txHash} label="transaction" href={explorerTx(p.txHash)} />
                  ) : (
                    <span className="text-muted-foreground capitalize">{p.status}</span>
                  )}
                  <span className="mono-num">{formatUsdc(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Wallet history">
          {d.walletEvents.length === 0 ? (
            <EmptyState>No wallet events.</EmptyState>
          ) : (
            <ul className="bg-card divide-y rounded-lg border text-sm">
              {d.walletEvents.map((e) => {
                const data = e.dataJson as { to?: string; txHash?: string; wallet?: string };
                return (
                  <li key={e.id} className="grid gap-1 p-3">
                    <div className="flex justify-between gap-3">
                      <span>{EVENT_LABEL[e.action] ?? e.action}</span>
                      <span className="text-muted-foreground mono-num text-xs">
                        {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {data.to || data.wallet ? (
                        <HexValue value={(data.to ?? data.wallet)!} label="wallet" />
                      ) : null}
                      {data.txHash ? (
                        <HexValue
                          value={data.txHash}
                          label="transaction"
                          href={explorerTx(data.txHash)}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
