import { formatUsdc } from "@misthos/shared";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ProgramStatus } from "@/components/app/program-status";
import { HexValue } from "@/components/hex-value";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { chainConfig } from "@/lib/server/chain";
import { appOrigin } from "@/lib/server/env";
import {
  getProgramForMember,
  getRounds,
  isReviewStatus,
  listContributors,
  listSubmissionsForReview,
  submissionCounts,
} from "@/lib/server/queries";
import Link from "next/link";
import { ReviewTable } from "@/components/review/review-table";
import { currentRound } from "@/lib/rounds";
import { getOwnerSession } from "@/lib/server/session";
import { PublishButton } from "./publish-button";

export default async function ProgramPage({
  params,
  searchParams,
}: PageProps<"/app/programs/[id]">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const row = await getProgramForMember(id, session.sub);
  if (!row) notFound();
  const { program, role } = row;
  const rawStatus = (await searchParams).status;
  const status = isReviewStatus(rawStatus) ? rawStatus : undefined;
  const [rounds, contributors, reviewRows, counts] = await Promise.all([
    getRounds(program.id),
    listContributors(program.id),
    // "Pending" covers both queued and in-review rows, so fetch all and filter below.
    listSubmissionsForReview(program.id, status === "pending" ? undefined : status),
    submissionCounts(program.id),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const limits = program.limitsJson;
  const joinUrl = `${appOrigin()}/join/${program.slug}`;
  const explorer = chainConfig().explorerUrl;
  const current = currentRound(rounds);

  return (
    <div className="grid gap-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{program.name}</h1>
            <ProgramStatus status={program.status} />
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{program.description}</p>
        </div>
        {role === "owner" ? <PublishButton programId={program.id} status={program.status} /> : null}
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <div className="text-muted-foreground text-xs">Join link</div>
          {program.status === "active" ? (
            <a href={joinUrl} className="mt-1 block truncate font-mono text-[13px] hover:underline">
              {joinUrl.replace(/^https?:\/\//, "")}
            </a>
          ) : (
            <p className="text-muted-foreground mt-1 text-sm">Publish to open the join page.</p>
          )}
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-muted-foreground text-xs">Contributors</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{contributors.length}</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-muted-foreground text-xs">Vault</div>
          {program.vaultAddress ? (
            <div className="mt-1">
              <HexValue
                value={program.vaultAddress}
                label="vault address"
                href={`${explorer}/address/${program.vaultAddress}`}
              />
            </div>
          ) : (
            <p className="text-muted-foreground mt-1 text-sm">
              Not deployed yet. Required before the first payout.
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-base font-medium">Rubric</h2>
          <ul className="mt-3 grid gap-3">
            {program.rubricJson.categories.map((c) => (
              <li key={c.key} className="rounded-lg border p-4 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono tabular-nums">
                    {c.maxPoints} pts · {formatUsdc(program.ratePerPoint * BigInt(c.maxPoints))}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1">{c.description}</p>
                <p className="text-muted-foreground mt-2 text-xs">
                  {c.criteria.map((k) => k.name).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-base font-medium">Limits</h2>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-2 rounded-lg border p-4 text-sm">
            <dt className="text-muted-foreground">Max per contributor per round</dt>
            <dd className="font-mono tabular-nums">{formatUsdc(BigInt(limits.maxPerPayout))}</dd>
            <dt className="text-muted-foreground">Max per round</dt>
            <dd className="font-mono tabular-nums">{formatUsdc(BigInt(limits.maxPerRound))}</dd>
            <dt className="text-muted-foreground">Max per rolling 24h</dt>
            <dd className="font-mono tabular-nums">{formatUsdc(BigInt(limits.maxPerDay))}</dd>
            <dt className="text-muted-foreground">Owner approval above</dt>
            <dd className="font-mono tabular-nums">
              {formatUsdc(BigInt(limits.autoApproveThreshold))}
            </dd>
            <dt className="text-muted-foreground">New wallet cooldown</dt>
            <dd className="tabular-nums">{limits.payeeCooldownSeconds / 3600} h</dd>
            <dt className="text-muted-foreground">Auto-approve confidence</dt>
            <dd className="tabular-nums">≥ {program.autoApproveConfidence}</dd>
          </dl>
          {current ? (
            <p className="text-muted-foreground mt-3 text-sm">
              Round {current.number}: {current.startsAt.toLocaleDateString()} to{" "}
              {current.endsAt.toLocaleDateString()}
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-medium">Submissions</h2>
          <nav aria-label="Filter by status" className="flex flex-wrap gap-1 text-xs">
            {(
              [
                [undefined, "All", total],
                ["escalated", "Needs review", counts.escalated ?? 0],
                ["approved", "Approved", counts.approved ?? 0],
                ["partial", "Partial", counts.partial ?? 0],
                ["rejected", "Rejected", counts.rejected ?? 0],
                ["pending", "Pending", (counts.pending ?? 0) + (counts.processing ?? 0)],
              ] as const
            ).map(([key, label, n]) => (
              <Link
                key={label}
                href={key ? `?status=${key}` : "?"}
                scroll={false}
                aria-current={status === key ? "page" : undefined}
                className={`rounded-md border px-2 py-1 tabular-nums ${status === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label} {n}
              </Link>
            ))}
          </nav>
        </div>
        <ReviewTable
          rows={reviewRows.filter(
            (r) => status !== "pending" || r.status === "pending" || r.status === "processing",
          )}
          maxPerPayout={limits.maxPerPayout}
        />
      </section>

      <section>
        <h2 className="text-base font-medium">Contributors</h2>
        {contributors.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            Nobody has joined yet. Share the join link to invite contributors.
          </p>
        ) : (
          <div className="mt-3 rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>X account</TableHead>
                  <TableHead>GitHub</TableHead>
                  <TableHead>Payout wallet</TableHead>
                  <TableHead className="text-right">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contributors.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>@{c.xHandle}</TableCell>
                    <TableCell className="text-muted-foreground">{c.githubLogin ?? "—"}</TableCell>
                    <TableCell>
                      {c.walletAddress ? (
                        <span className="inline-flex items-center gap-2">
                          <HexValue
                            value={c.walletAddress}
                            label="wallet"
                            href={`${explorer}/address/${c.walletAddress}`}
                          />
                          {c.walletChangedAt ? (
                            <span
                              className="bg-warning-subtle text-warning rounded-md px-1.5 text-xs"
                              title={c.walletChangedAt.toISOString()}
                            >
                              changed
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {c.createdAt.toISOString().slice(0, 10)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
