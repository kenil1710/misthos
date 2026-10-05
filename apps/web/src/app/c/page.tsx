import { formatUsdc } from "@misthos/shared/money";
import Link from "next/link";
import { LinkArt } from "@/components/brand/illustrations";
import { SignOutButton } from "@/components/app/sign-out-button";
import { SiteHeader } from "@/components/app/site-header";
import { JoinedCard } from "@/components/contributor/joined-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-kit";
import { joinedPrograms } from "@/lib/server/joined";
import { getContributorSession, getOwnerSession } from "@/lib/server/session";

export const metadata = { title: "Programs you joined", robots: { index: false } };

/** The contributor's home: every program they joined, with its round, what's waiting and what they've earned. */
export default async function ContributorHomeIndex() {
  const [session, owner] = await Promise.all([getContributorSession(), getOwnerSession()]);
  const joined = session ? await joinedPrograms(session.xid) : [];
  return (
    <>
      <SiteHeader
        right={
          <>
            {owner ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/app">Your programs</Link>
              </Button>
            ) : null}
            {session ? <SignOutButton kind="contributor" /> : null}
          </>
        }
      />
      <main
        id="main"
        className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-10 px-4 py-8 sm:px-6 sm:py-12"
      >
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="display text-[2.5rem] leading-[1.05] sm:text-[3.25rem]">
              Programs you <em>joined</em>
            </h1>
            <p className="text-soft mt-2 text-[15px]">
              {session
                ? `Signed in with X as @${session.xh}.`
                : "Sign in with X to see the programs you joined."}
            </p>
          </div>
          {session && joined.length > 0 ? (
            <dl className="bg-card shadow-soft flex gap-8 rounded-[1.25rem] px-6 py-4">
              <div>
                <dt className="text-muted-foreground text-xs">Earned in total</dt>
                <dd className="display text-[2rem] leading-none tabular-nums">
                  {formatUsdc(
                    joined.reduce((s, j) => s + j.earned, 0n),
                    { withSymbol: false },
                  )}
                  <span className="text-muted-foreground ml-1 font-sans text-xs">USDC</span>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">In review</dt>
                <dd className="display text-[2rem] leading-none tabular-nums">
                  {joined.reduce((s, j) => s + j.inReview, 0)}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
        {!session ? (
          <section className="bg-card shadow-soft grid max-w-xl justify-items-start gap-4 rounded-[1.5rem] p-6 sm:p-8">
            <LinkArt className="size-20" />
            <p className="text-soft text-sm leading-relaxed">
              Your earnings, submissions and payouts live here. Sign in with the X account you
              joined with.
            </p>
            <Button asChild>
              <a href={`/api/auth/x/start?next=${encodeURIComponent("/c")}`}>Sign in with X</a>
            </Button>
          </section>
        ) : joined.length === 0 ? (
          <EmptyState art="link" title="No programs yet">
            You haven&apos;t joined a program yet. Open a program&apos;s join link (owners share it
            on X) to get started.
          </EmptyState>
        ) : (
          <section
            aria-label="Programs you joined"
            className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            {joined.map((j) => (
              <JoinedCard key={j.contributorId} j={j} />
            ))}
          </section>
        )}
      </main>
    </>
  );
}
