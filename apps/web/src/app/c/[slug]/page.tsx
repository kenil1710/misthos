import { formatUsdc, Slug } from "@misthos/shared";
import { notFound, redirect } from "next/navigation";
import { SignOutButton } from "@/components/app/sign-out-button";
import { SiteHeader } from "@/components/app/site-header";
import { Submissions } from "@/components/contributor/submissions";
import { WalletLink } from "@/components/contributor/wallet-link";
import { HexValue } from "@/components/hex-value";
import { Web3Provider } from "@/components/web3/web3-provider";
import { chainConfig } from "@/lib/server/chain";
import { getContributorMembership, getProgramBySlug } from "@/lib/server/queries";
import { cooldownEndsAt } from "@/lib/rounds";
import { contributorDetail } from "@/lib/server/contributors-view";
import { EmptyState, Section, Stat } from "@/components/ui-kit";
import Link from "next/link";
import { getContributorSession } from "@/lib/server/session";

export const metadata = { title: "Your contributions" };

export default async function ContributorHome({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const parsed = Slug.safeParse(slug);
  if (!parsed.success) notFound();
  const program = await getProgramBySlug(parsed.data);
  if (!program) notFound();
  const session = await getContributorSession();
  if (!session) redirect(`/join/${program.slug}`);
  const me = await getContributorMembership(program.id, session.xid);
  if (!me) redirect(`/join/${program.slug}`);

  const cooldownEnds = cooldownEndsAt(me.walletChangedAt, program.limitsJson.payeeCooldownSeconds);
  const detail = await contributorDetail(program.id, me.id);
  const earned =
    detail?.payouts.filter((p) => p.p.status === "executed").reduce((s, p) => s + p.p.amount, 0n) ??
    0n;
  const awaiting =
    detail?.submissions
      .filter((s) => s.status === "approved" || s.status === "partial")
      .reduce((sum, s) => sum + (s.amount ?? 0n), 0n) ?? 0n;
  const reviewed =
    detail?.submissions.filter((s) => !["pending", "processing"].includes(s.status)).length ?? 0;
  const explorer = chainConfig().explorerUrl;

  return (
    <Web3Provider>
      <SiteHeader right={<SignOutButton kind="contributor" />} />
      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-10 px-4 py-12 sm:px-6">
        <div>
          <p className="text-muted-foreground text-sm">{program.name}</p>
          <h1 className="mt-1 text-2xl font-semibold">Your contributions</h1>
        </div>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="Your totals">
          <Stat
            label="Earned"
            value={formatUsdc(earned, { withSymbol: false })}
            hint="USDC paid to your wallet"
          />
          <Stat
            label="Approved, paid next round"
            value={formatUsdc(awaiting, { withSymbol: false })}
            hint="USDC"
          />
          <Stat
            label="Reviewed"
            value={reviewed}
            hint={`of ${detail?.submissions.length ?? 0} submitted`}
          />
        </section>

        <section className="rounded-lg border p-5">
          <Submissions
            programSlug={program.slug}
            acceptedSources={[
              ...new Set(program.rubricJson.categories.flatMap((c) => c.sourceTypes)),
            ]}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border p-5">
            <h2 className="text-base font-medium">Account</h2>
            <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">X</dt>
              <dd>@{me.xHandle}</dd>
              <dt className="text-muted-foreground">GitHub</dt>
              <dd>{me.githubLogin ?? <span className="text-muted-foreground">Not set</span>}</dd>
              <dt className="text-muted-foreground">Payout wallet</dt>
              <dd>
                {me.walletAddress ? (
                  <HexValue
                    value={me.walletAddress}
                    label="payout wallet"
                    href={`${explorer}/address/${me.walletAddress}`}
                  />
                ) : (
                  "Not linked"
                )}
              </dd>
              <dt className="text-muted-foreground">Verified</dt>
              <dd className="tabular-nums">
                {me.walletVerifiedAt
                  ? `${me.walletVerifiedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
                  : "—"}
              </dd>
            </dl>
            {cooldownEnds ? (
              <p className="bg-warning-subtle text-warning mt-4 rounded-md p-3 text-sm">
                You changed your wallet recently. Payouts to it start after{" "}
                {`${cooldownEnds.toISOString().slice(0, 16).replace("T", " ")} UTC`}.
              </p>
            ) : null}
          </div>
          <div className="rounded-lg border p-5">
            <h2 className="text-base font-medium">Change payout wallet</h2>
            <p className="text-muted-foreground mt-1 mb-4 text-sm">
              Connect the new wallet and sign. For your safety, a new wallet can&apos;t be paid
              until the cooldown passes.
            </p>
            <WalletLink programSlug={program.slug} mode="change" showGithub={false} />
          </div>
        </section>
        <Section
          title="Payout history"
          description="Every payment is a USDC transfer on Arc from this program's vault."
        >
          {!detail || detail.payouts.length === 0 ? (
            <EmptyState>No payouts yet. Approved work is paid when the round closes.</EmptyState>
          ) : (
            <ul className="bg-card divide-y rounded-lg border text-sm">
              {detail.payouts.map(({ p, roundNumber, roundId }) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <Link href={`/p/${program.slug}/rounds/${roundId}`} className="hover:underline">
                    Round {roundNumber} receipt
                  </Link>
                  {p.txHash ? (
                    <HexValue
                      value={p.txHash}
                      label="transaction"
                      href={`${explorer}/tx/${p.txHash}`}
                    />
                  ) : (
                    <span className="text-muted-foreground capitalize">{p.status}</span>
                  )}
                  <span className="mono-num">{formatUsdc(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </main>
    </Web3Provider>
  );
}
