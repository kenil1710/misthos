import Link from "next/link";
import { AppShell } from "@/components/app/app-shell";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { OwnerSignIn } from "@/components/web3/islands";
import { isFounder } from "@/lib/server/founders";
import { listProgramsForUser, needsReviewCounts } from "@/lib/server/queries";
import { getContributorSession, getOwnerSession } from "@/lib/server/session";

export const metadata = { title: "App" };

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const session = await getOwnerSession();
  if (!session)
    return (
      <>
        <div className="flex min-h-dvh flex-col">
          <header className="flex h-14 items-center justify-between px-4 sm:px-6">
            <Link href="/" aria-label="Misthos home" className="rounded-md">
              <Wordmark />
            </Link>
            <ThemeToggle />
          </header>
          <main id="main" className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16">
            <section className="bg-card w-full max-w-[26rem] rounded-xl border p-6 sm:p-8">
              <h1 className="text-xl font-medium tracking-tight">Sign in to Misthos</h1>
              <p className="text-muted-foreground mt-1.5 mb-7 text-sm leading-relaxed">
                Run contributor programs: the agent reviews submitted work and pays it from a vault
                you own.
              </p>
              <OwnerSignIn />
            </section>
          </main>
        </div>
      </>
    );

  const [programs, review, founder, contributor] = await Promise.all([
    listProgramsForUser(session.sub),
    needsReviewCounts(session.sub),
    isFounder(session),
    getContributorSession(),
  ]);
  return (
    <AppShell
      address={session.addr}
      founder={founder}
      contributor={!!contributor}
      programs={programs.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.status,
        review: review[p.id] ?? 0,
      }))}
    >
      {children}
    </AppShell>
  );
}
