import Link from "next/link";
import { ProgramStatus } from "@/components/app/program-status";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listProgramsForUser } from "@/lib/server/queries";
import { getOwnerSession } from "@/lib/server/session";

export default async function ProgramsPage() {
  const session = await getOwnerSession();
  if (!session) return null; // layout renders sign-in
  const programs = await listProgramsForUser(session.sub);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Programs</h1>
        {programs.length ? (
          <Button asChild size="sm">
            <Link href="/app/programs/new">New program</Link>
          </Button>
        ) : null}
      </div>
      {programs.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground text-sm">You don&apos;t run any programs yet.</p>
          <Button asChild className="mt-4">
            <Link href="/app/programs/new">Create a program</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-6 rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {programs.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/app/programs/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-muted-foreground font-mono text-xs">/{p.slug}</div>
                  </TableCell>
                  <TableCell>
                    <ProgramStatus status={p.status} />
                  </TableCell>
                  <TableCell className="capitalize">{p.role}</TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {p.createdAt.toISOString().slice(0, 10)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
