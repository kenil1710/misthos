import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { appOrigin } from "@/lib/server/env";
import { isFounder } from "@/lib/server/founders";
import { selectedNetwork } from "@/lib/server/network";
import { programSummaries } from "@/lib/server/program-summary";
import type { getOwnerSession } from "@/lib/server/session";
import { shareOnXUrl } from "@/lib/share";
import { roundPill } from "@/lib/status-line";

type OwnerSession = NonNullable<Awaited<ReturnType<typeof getOwnerSession>>>;

/** The signed-in owner's app frame (sidebar, top bar), with their programs. Used by /app and, signed in, /campaigns. */
export async function OwnerAppShell({
  session,
  contributor,
  children,
}: {
  session: OwnerSession;
  /** Also signed in with X. */
  contributor: boolean;
  children: ReactNode;
}) {
  const [summaries, founder, network] = await Promise.all([
    programSummaries(session.sub),
    isFounder(session),
    selectedNetwork(),
  ]);
  const origin = appOrigin();
  return (
    <AppShell
      address={session.addr}
      founder={founder}
      contributor={contributor}
      network={network}
      programs={summaries.map(({ program: p, waitingReview, needs, round }) => ({
        id: p.id,
        chain: p.chain,
        name: p.name,
        slug: p.slug,
        status: p.status,
        review: waitingReview,
        roundPill: p.status === "draft" ? null : roundPill(round),
        needs: needs.map(({ text, href, action, kind }) => ({ text, href, action, kind })),
        joinUrl: `${origin}/join/${p.slug}`,
        shareHref: shareOnXUrl({
          name: p.name,
          joinUrl: `${origin}/join/${p.slug}`,
          sources: [...new Set(p.rubricJson.categories.flatMap((c) => c.sourceTypes))],
          bestPayout: p.rubricJson.categories.reduce(
            (m, c) =>
              p.ratePerPoint * BigInt(c.maxPoints) > m ? p.ratePerPoint * BigInt(c.maxPoints) : m,
            0n,
          ),
        }),
      }))}
    >
      {children}
    </AppShell>
  );
}
