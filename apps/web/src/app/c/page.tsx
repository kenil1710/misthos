import Link from "next/link";
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
      <main id="main" className="mx-auto grid w-full max-w-5xl flex-1 gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <div>
          <h1 className="text-2xl font-medium tracking-[-0.02em]">Programs you joined</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {session
              ? `Signed in with X as @${session.xh}.`
              : "Sign in with X to see the programs you joined."}
          </p>
        </div>
        {!session ? (
          <div>
            <Button asChild>
              <a href={`/api/auth/x/start?next=${encodeURIComponent("/c")}`}>Sign in with X</a>
            </Button>
          </div>
        ) : joined.length === 0 ? (
          <EmptyState>
            You haven&apos;t joined a program yet. Open a program&apos;s join link to get started.
          </EmptyState>
        ) : (
          <section aria-label="Programs you joined" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {joined.map((j) => (
              <JoinedCard key={j.contributorId} j={j} />
            ))}
          </section>
        )}
      </main>
    </>
  );
}
