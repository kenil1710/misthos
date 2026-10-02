import { formatUsdc } from "@misthos/shared";
import Link from "next/link";
import { HexValue } from "@/components/hex-value";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, PageHeader, TableFrame } from "@/components/ui-kit";
import { contributorsTable } from "@/lib/server/contributors-view";
import { getProgramForMember } from "@/lib/server/queries";
import { getOwnerSession } from "@/lib/server/session";
import { explorerAddress } from "@/lib/server/vault";

export const metadata = { title: "Contributors" };

export default async function ContributorsPage({
  params,
}: PageProps<"/app/programs/[id]/contributors">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  const row = await getProgramForMember(id, session.sub);
  if (!row) return null;
  const list = await contributorsTable(id);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Contributors"
        description="Everyone who joined, what they've earned, and how often their work was approved."
      />
      {list.length === 0 ? (
        <EmptyState
          action={
            row.program.status === "active"
              ? { label: "Open the join page", href: `/join/${row.program.slug}` }
              : undefined
          }
        >
          Nobody has joined yet. Share the join link to invite contributors.
        </EmptyState>
      ) : (
        <TableFrame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contributor</TableHead>
                <TableHead>Payout wallet</TableHead>
                <TableHead className="text-right">Earned</TableHead>
                <TableHead className="text-right">Submissions</TableHead>
                <TableHead className="text-right">Approval rate</TableHead>
                <TableHead className="text-right">Flagged</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/app/programs/${id}/contributors/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      @{c.xHandle}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      {c.githubLogin ? `GitHub ${c.githubLogin}` : "No GitHub username"}
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.walletAddress ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <HexValue
                          value={c.walletAddress}
                          label="wallet"
                          href={explorerAddress(c.walletAddress)}
                        />
                        {c.walletChangedAt ? (
                          <span className="bg-warning-subtle text-warning rounded px-1.5 text-xs">
                            changed {c.walletChangedAt.toISOString().slice(0, 10)}
                          </span>
                        ) : null}
                        {c.payeeWallet && c.payeeWallet === c.walletAddress ? null : row.program
                            .vaultAddress ? (
                          <span className="text-muted-foreground text-xs">
                            registering in vault
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not linked</span>
                    )}
                  </TableCell>
                  <TableCell className="mono-num text-right">
                    {formatUsdc(c.earned, { withSymbol: false })}
                  </TableCell>
                  <TableCell className="mono-num text-right">{c.submissions}</TableCell>
                  <TableCell className="mono-num text-right">
                    {c.approvalRate === null ? "—" : `${Math.round(c.approvalRate * 100)}%`}
                  </TableCell>
                  <TableCell className={`mono-num text-right ${c.flagged ? "text-danger" : ""}`}>
                    {c.flagged}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      )}
    </div>
  );
}
