import { formatUsdc, Slug, SOURCE_LABELS } from "@misthos/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SignOutButton } from "@/components/app/sign-out-button";
import { SiteHeader } from "@/components/app/site-header";
import { WalletLink } from "@/components/contributor/wallet-link";
import { Button } from "@/components/ui/button";
import { Web3Provider } from "@/components/web3/web3-provider";
import { getContributorMembership, getProgramBySlug, getRounds } from "@/lib/server/queries";
import { currentRound } from "@/lib/rounds";
import { getContributorSession } from "@/lib/server/session";

const X_ERRORS: Record<string, string> = {
  denied: "X sign-in was cancelled.",
  expired: "The sign-in took too long. Try again.",
  state_mismatch: "The sign-in couldn't be verified. Try again.",
  x_unavailable: "X didn't respond. Try again in a minute.",
};

async function load(slug: string) {
  const parsed = Slug.safeParse(slug);
  if (!parsed.success) return null;
  const program = await getProgramBySlug(parsed.data);
  // Drafts and archived programs don't have a public join page.
  return program && (program.status === "active" || program.status === "paused") ? program : null;
}

export async function generateMetadata({ params }: PageProps<"/join/[slug]">): Promise<Metadata> {
  const program = await load((await params).slug);
  return program ? { title: `Join ${program.name}`, description: program.description } : {};
}

export default async function JoinPage({ params, searchParams }: PageProps<"/join/[slug]">) {
  const { slug } = await params;
  const program = await load(slug);
  if (!program) notFound();
  const xError = (await searchParams).x_error;
  const session = await getContributorSession();
  const membership = session ? await getContributorMembership(program.id, session.xid) : null;
  const rounds = await getRounds(program.id);
  const round = currentRound(rounds);

  return (
    <Web3Provider>
      <SiteHeader right={session ? <SignOutButton kind="contributor" /> : null} />
      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_360px]">
        <article>
          <p className="text-muted-foreground text-sm">Contributor program</p>
          <h1 className="mt-1 text-3xl font-semibold">{program.name}</h1>
          <p className="text-muted-foreground mt-3 max-w-2xl">{program.description}</p>

          <h2 className="mt-10 text-base font-medium">What this program pays for</h2>
          <ul className="mt-3 grid gap-3">
            {program.rubricJson.categories.map((c) => (
              <li key={c.key} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono text-sm tabular-nums">
                    up to {formatUsdc(program.ratePerPoint * BigInt(c.maxPoints))}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">{c.description}</p>
                <p className="text-muted-foreground mt-2 text-xs">
                  {c.sourceTypes.map((t) => SOURCE_LABELS[t]).join(", ")} · scored on{" "}
                  {c.criteria.map((k) => k.name.toLowerCase()).join(", ")}
                </p>
                {c.rules ? <p className="mt-2 text-sm">{c.rules}</p> : null}
              </li>
            ))}
          </ul>
          {program.rubricJson.generalRules ? (
            <>
              <h2 className="mt-10 text-base font-medium">Rules</h2>
              <p className="mt-2 text-sm whitespace-pre-line">{program.rubricJson.generalRules}</p>
            </>
          ) : null}
          <h2 className="mt-10 text-base font-medium">How you get paid</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            An AI agent checks that the work is yours, original, and inside the round, scores it
            against the rubric, and explains its decision. Payouts are sent in USDC on Arc from a
            vault with on-chain limits. Every decision is published on the program&apos;s audit
            page.
          </p>
        </article>

        <aside className="h-fit rounded-lg border p-5 lg:sticky lg:top-6">
          {round ? (
            <p className="text-muted-foreground text-sm">
              Round {round.number}: {round.startsAt.toISOString().slice(0, 10)} to{" "}
              {round.endsAt.toISOString().slice(0, 10)}
            </p>
          ) : null}
          {program.status === "paused" ? (
            <p className="mt-3 text-sm">
              This program isn&apos;t accepting new contributors right now.
            </p>
          ) : membership ? (
            <div className="mt-3 grid gap-3">
              <p className="text-sm">You&apos;re in as @{membership.xHandle}.</p>
              <Button asChild>
                <Link href={`/c/${program.slug}`}>Go to your dashboard</Link>
              </Button>
            </div>
          ) : !session ? (
            <div className="mt-3 grid gap-3">
              <h2 className="font-medium">Join in two steps</h2>
              <ol className="text-muted-foreground list-decimal pl-4 text-sm">
                <li>Sign in with X so we can confirm which posts are yours.</li>
                <li>Connect the wallet you want to be paid in.</li>
              </ol>
              <Button asChild>
                <a href={`/api/auth/x/start?next=${encodeURIComponent(`/join/${program.slug}`)}`}>
                  Sign in with X
                </a>
              </Button>
              {typeof xError === "string" && X_ERRORS[xError] ? (
                <p role="alert" className="text-danger text-sm">
                  {X_ERRORS[xError]}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 grid gap-3">
              <p className="text-sm">
                Signed in as <span className="font-medium">@{session.xh}</span>. Last step: your
                payout wallet.
              </p>
              <WalletLink programSlug={program.slug} mode="join" />
            </div>
          )}
        </aside>
      </main>
    </Web3Provider>
  );
}
