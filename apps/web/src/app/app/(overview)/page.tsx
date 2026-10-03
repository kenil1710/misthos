import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import heroDark from "@/assets/landing/hero-dark.png";
import heroLight from "@/assets/landing/hero-light.png";
import { AllPrograms } from "@/components/app/all-programs";
import { JoinedCard } from "@/components/contributor/joined-card";
import { ProductFrame } from "@/components/landing/product-frame";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/ui-kit";
import { joinedPrograms } from "@/lib/server/joined";
import { exampleAuditSlug } from "@/lib/server/landing";
import { programSummaries } from "@/lib/server/program-summary";
import { getContributorSession, getOwnerSession } from "@/lib/server/session";

export default async function OverviewPage() {
  const session = await getOwnerSession();
  if (!session) return null; // layout renders sign-in
  const [summaries, contributor] = await Promise.all([
    programSummaries(session.sub),
    getContributorSession(),
  ]);
  const joined = contributor ? await joinedPrograms(contributor.xid) : [];

  if (!summaries.length) {
    const example = await exampleAuditSlug();
    return (
      <div className="grid gap-8">
        <PageHeader
          title="Welcome to Misthos"
          description="Set up a contributor program once; the agent reviews every submission and pays approved work from a vault you own."
        />
        <section className="bg-card grid items-center gap-8 overflow-hidden rounded-xl border p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <h2 className="text-base font-medium">Your first program takes about five minutes</h2>
            <ol className="text-soft mt-4 grid gap-3 text-sm">
              {[
                ["Write the rules", "What you pay for, how it's scored, and your limits."],
                ["Deploy and fund the vault", "One transaction to create it, one to deposit USDC."],
                [
                  "Share the join link",
                  "Contributors sign in with X and submit links to their work.",
                ],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums">
                    {i + 1}
                  </span>
                  <span>
                    <span className="text-foreground block font-medium">{t}</span>
                    {d}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button asChild>
                <Link href="/app/programs/new">Create your first program</Link>
              </Button>
              {example ? (
                <Button asChild variant="ghost">
                  <Link href={`/p/${example}`} target="_blank">
                    See a live example
                    <ArrowUpRight className="size-3.5" strokeWidth={1.5} />
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
          <ProductFrame
            light={heroLight}
            dark={heroDark}
            sizes="(min-width: 1024px) 560px, 100vw"
            className="lg:-mr-12"
            alt="The review queue: every submission with the agent's decision, its reasons, and the amount."
          />
        </section>
        {joined.length ? (
          <Section title="Programs you joined">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {joined.map((j) => (
                <JoinedCard key={j.contributorId} j={j} />
              ))}
            </div>
          </Section>
        ) : null}
      </div>
    );
  }

  if (summaries.length === 1) redirect(`/app/programs/${summaries[0]!.program.id}`);
  return <AllPrograms summaries={summaries} joined={joined} />;
}
