import Link from "next/link";
import { ReviewTable } from "@/components/review/review-table";
import { PageHeader } from "@/components/ui-kit";
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
        title="Submissions"
        description="Open any row to see the content, flags with evidence, scores and reasoning, and to approve, adjust or reject it."
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
      <ReviewTable
        rows={rows.filter(
          (r) => status !== "pending" || r.status === "pending" || r.status === "processing",
        )}
        maxPerPayout={row.program.limitsJson.maxPerPayout}
      />
    </div>
  );
}
