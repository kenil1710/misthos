import Link from "next/link";
import { JoinedCard } from "@/components/contributor/joined-card";
import { ActionBadge } from "@/components/public/action-badge";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/ui-kit";
import type { JoinedProgram } from "@/lib/server/joined";
import type { ProgramSummary } from "@/lib/server/program-summary";
import { recentDecisions } from "@/lib/server/overview";
import { relativeTime, utc } from "@/lib/time";
import { NeedsYou, ProgramCard } from "./program-home";

/** The signed-in owner's home with several programs: what needs them, a card per program, and what they joined. */
export async function AllPrograms({
  summaries,
  joined,
}: {
  summaries: ProgramSummary[];
  joined: JoinedProgram[];
}) {
  const feed = await recentDecisions(
    summaries.map((s) => s.program.id),
    5,
  );
  const needs = summaries.flatMap((s) => s.needs.map((n) => ({ ...n, programId: s.program.id })));
  const names = Object.fromEntries(summaries.map((s) => [s.program.id, s.program.name]));
  return (
    <div className="grid gap-10">
      <PageHeader
        title="Your programs"
        description="What needs you, and how each program is doing."
        actions={
          <Button asChild size="sm">
            <Link href="/app/programs/new">New program</Link>
          </Button>
        }
      />
      <NeedsYou items={needs} showProgram programNames={names} />
      <section aria-label="Programs" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaries.map((s) => (
          <ProgramCard key={s.program.id} s={s} />
        ))}
      </section>
      {joined.length ? (
        <Section
          title="Programs you joined"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/c">See all</Link>
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {joined.map((j) => (
              <JoinedCard key={j.contributorId} j={j} />
            ))}
          </div>
        </Section>
      ) : null}
      {feed.length ? (
        <Section title="Recent agent decisions">
          <ul className="bg-card divide-y rounded-lg border">
            {feed.map((d) => (
              <li key={d.hash} className="grid gap-1 p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <ActionBadge action={d.action} />
                  <span>@{d.handle}</span>
                  <Link
                    href={`/app/programs/${d.programId}/submissions`}
                    className="text-muted-foreground hover:underline"
                  >
                    {d.programName}
                  </Link>
                  <time
                    dateTime={d.createdAt.toISOString()}
                    title={utc(d.createdAt)}
                    className="text-muted-foreground mono-num ml-auto text-xs"
                  >
                    {relativeTime(d.createdAt)}
                  </time>
                </div>
                <p className="text-sm">{d.summary}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
