import { formatUsdc, Slug } from "@misthos/shared";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SignOutButton } from "@/components/app/sign-out-button";
import { SiteHeader } from "@/components/app/site-header";
import { ChangeWallet } from "@/components/contributor/change-wallet";
import { GithubEditor } from "@/components/contributor/github-editor";
import { Submissions } from "@/components/contributor/submissions";
import { HexValue } from "@/components/hex-value";
import { EmptyState, Notice } from "@/components/ui-kit";
import { Web3Provider } from "@/components/web3/web3-provider";
import { cooldownEndsAt, currentRound } from "@/lib/rounds";
import { chainConfig } from "@/lib/server/chain";
import { contributorDetail } from "@/lib/server/contributors-view";
import { getContributorMembership, getProgramBySlug, getRounds } from "@/lib/server/queries";
import { getContributorSession } from "@/lib/server/session";
import { utc, utcDay } from "@/lib/time";

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

  const cooldownSeconds = program.limitsJson.payeeCooldownSeconds;
  const cooldownEnds = cooldownEndsAt(me.walletChangedAt, cooldownSeconds);
  const [detail, rounds] = await Promise.all([
    contributorDetail(program.id, me.id),
    getRounds(program.id),
  ]);
  const round = currentRound(rounds);
  const roundOpen = round && round.status === "open";
  const earned =
    detail?.payouts.filter((p) => p.p.status === "executed").reduce((s, p) => s + p.p.amount, 0n) ??
    0n;
  const awaiting =
    detail?.submissions
      .filter((s) => s.status === "approved" || s.status === "partial")
      .reduce((sum, s) => sum + (s.amount ?? 0n), 0n) ?? 0n;
  const explorer = chainConfig().explorerUrl;

  return (
    <Web3Provider>
      <SiteHeader right={<SignOutButton kind="contributor" />} />
      <main
        id="main"
        className="mx-auto grid w-full max-w-3xl flex-1 grid-cols-[minmax(0,1fr)] gap-8 px-4 py-8 sm:px-6 sm:py-12"
      >
        <div>
          <p className="text-muted-foreground text-sm">
            {program.name} · @{me.xHandle}
          </p>
          <h1 className="mt-1 text-2xl font-medium tracking-[-0.02em]">Your contributions</h1>
          {round ? (
            <p className="text-soft mt-2 text-sm">
              {roundOpen
                ? `Round ${round.number} is open until ${utc(round.endsAt)}. Approved work is paid when it closes.`
                : `Round ${round.number}: ${utcDay(round.startsAt)} to ${utcDay(round.endsAt)}.`}
            </p>
          ) : null}
        </div>

        {program.status === "paused" ? (
          <Notice>This program has paused new sign-ups. You can keep submitting.</Notice>
        ) : null}

        <dl
          className="bg-card grid grid-cols-2 divide-x rounded-xl border"
          aria-label="Your totals"
        >
          <div className="p-4">
            <dt className="text-muted-foreground text-xs">Paid to you</dt>
            <dd className="mono-num mt-1 text-xl">{formatUsdc(earned, { withSymbol: false })}</dd>
            <dd className="text-muted-foreground mt-1 text-xs">USDC</dd>
          </div>
          <div className="p-4">
            <dt className="text-muted-foreground text-xs">Approved, not yet paid</dt>
            <dd className="mono-num mt-1 text-xl">{formatUsdc(awaiting, { withSymbol: false })}</dd>
            <dd className="text-muted-foreground mt-1 text-xs">
              {roundOpen && round
                ? `USDC, paid after ${utcDay(round.endsAt)}`
                : "USDC, paid when the round closes"}
            </dd>
          </div>
        </dl>

        <section className="bg-card min-w-0 rounded-xl border p-4 sm:p-6">
          <Submissions
            programSlug={program.slug}
            acceptedSources={[
              ...new Set(program.rubricJson.categories.flatMap((c) => c.sourceTypes)),
            ]}
            roundNumber={roundOpen && round ? round.number : null}
            roundEndsAt={roundOpen && round ? round.endsAt.toISOString() : null}
            verifyBase={`/p/${program.slug}`}
          />
        </section>

        <section className="grid gap-3">
          <h2 className="font-medium">Payouts</h2>
          {!detail || detail.payouts.length === 0 ? (
            <EmptyState>No payouts yet. Approved work is paid when the round closes.</EmptyState>
          ) : (
            <ul className="bg-card divide-y rounded-xl border text-sm">
              {detail.payouts.map(({ p, roundNumber, roundId }) => (
                <li
                  key={p.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 p-4"
                >
                  <Link
                    href={`/p/${program.slug}/rounds/${roundId}`}
                    className="font-medium hover:underline"
                  >
                    Round {roundNumber} receipt
                  </Link>
                  <span className="mono-num">{formatUsdc(p.amount)}</span>
                  <span className="col-span-2">
                    {p.txHash ? (
                      <HexValue
                        value={p.txHash}
                        label="transaction"
                        href={`${explorer}/tx/${p.txHash}`}
                      />
                    ) : (
                      <span className="text-muted-foreground capitalize">{p.status}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-card grid gap-4 rounded-xl border p-4 sm:p-6">
          <h2 className="font-medium">Account</h2>
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-y-3 text-sm">
            <dt className="text-muted-foreground">X</dt>
            <dd>@{me.xHandle}</dd>
            <dt className="text-muted-foreground">GitHub</dt>
            <dd>
              <GithubEditor programSlug={program.slug} current={me.githubLogin} />
            </dd>
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
          </dl>
          {cooldownEnds ? (
            <Notice>
              You changed your wallet recently. For your safety, payouts to it start after{" "}
              {utc(cooldownEnds)}.
            </Notice>
          ) : null}
          <div>
            <ChangeWallet
              programSlug={program.slug}
              cooldownHours={cooldownSeconds / 3600}
              currentWallet={me.walletAddress}
            />
          </div>
        </section>
      </main>
    </Web3Provider>
  );
}
