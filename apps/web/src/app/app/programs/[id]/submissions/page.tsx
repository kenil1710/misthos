import Link from "next/link";
import { ReviewTable } from "@/components/review/review-table";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui-kit";
import { CopyField } from "@/components/ui-kit/copy-field";
import { appOrigin } from "@/lib/server/env";
import {
  getProgramForMember,
  isReviewStatus,
  listSubmissionsForReview,
  submissionCounts,
} from "@/lib/server/queries";
import { getOwnerSession } from "@/lib/server/session";

export const metadata = { title: "Submissions" };

export default async function SubmissionsPage({
  params,
  searchParams,
}: PageProps<"/app/programs/[id]/submissions">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  const row = await getProgramForMember(id, session.sub);
  if (!row) return null;
  const rawStatus = (await searchParams).status;
  const status = isReviewStatus(rawStatus) ? rawStatus : undefined;
  const [rows, counts] = await Promise.all([
    listSubmissionsForReview(id, status === "pending" ? undefined : status),
    submissionCounts(id),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const published = row.program.status === "active" || row.program.status === "paused";
  const joinUrl = `${appOrigin()}/join/${row.program.slug}`;
  const filters = [
    [undefined, "All", total],
    ["escalated", "Needs review", counts.escalated ?? 0],
    ["approved", "Approved", counts.approved ?? 0],
    ["partial", "Partial", counts.partial ?? 0],
    ["paid", "Paid", counts.paid ?? 0],
    ["rejected", "Rejected", counts.rejected ?? 0],
    ["pending", "Queued", (counts.pending ?? 0) + (counts.processing ?? 0)],
  ] as const;

  return (
    <div className="grid gap-6">
      <PageHeader
        crumbs={[
          { label: row.program.name, href: `/app/programs/${id}` },
          { label: "Submissions" },
        ]}
        title="Submissions"
        description="Everything contributors sent and what the agent decided. Open a row for the evidence, scores and reasoning, and to approve, adjust or reject it."
      />
      <nav aria-label="Filter by status" className="flex flex-wrap gap-1 text-[13px]">
        {filters.map(([key, label, n]) => (
          <Link
            key={label}
            href={key ? `?status=${key}` : "?"}
            scroll={false}
            aria-current={status === key ? "page" : undefined}
            className={`rounded-md border px-2.5 py-1 ${status === key ? "bg-secondary text-foreground border-foreground/20" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label} <span className="mono-num">{n}</span>
          </Link>
        ))}
      </nav>
      {total === 0 ? (
        <section className="bg-card grid justify-items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <Inbox className="text-muted-foreground size-6" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="font-medium">No submissions yet</h2>
          <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
            Contributors join with your link, sign in with X and paste links to their work. Each
            submission shows up here within a minute, with the agent&apos;s decision and reasons.
          </p>
          {published ? (
            <div className="w-full max-w-md">
              <CopyField
                value={joinUrl}
                label="join link"
                display={joinUrl.replace(/^https?:\/\//, "")}
              />
            </div>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href={`/app/programs/${id}/settings`}>Publish the join page</Link>
            </Button>
          )}
        </section>
      ) : rows.length === 0 ? (
        <EmptyState action={{ label: "Show all submissions", href: "?" }}>
          Nothing is {filters.find(([k]) => k === status)?.[1].toLowerCase() ?? "here"} right now.
        </EmptyState>
      ) : (
        <ReviewTable
          rows={rows.filter(
            (r) => status !== "pending" || r.status === "pending" || r.status === "processing",
          )}
          maxPerPayout={row.program.limitsJson.maxPerPayout}
        />
      )}
    </div>
  );
}
