import { notFound } from "next/navigation";
import { z } from "zod";
import { VaultPausedBanner } from "@/components/app/vault-paused-banner";
import { NoProgramAccess } from "@/components/app/no-access";
import { getProgramForMember, listProgramsForUser } from "@/lib/server/queries";
import { getOwnerSession } from "@/lib/server/session";
import { readVault } from "@/lib/server/vault";
import type { Address } from "viem";

export default async function ProgramLayout({
  children,
  params,
}: LayoutProps<"/app/programs/[id]">) {
  const session = await getOwnerSession();
  if (!session) return children; // the /app layout renders sign-in
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const row = await getProgramForMember(id, session.sub);
  if (!row)
    return (
      <NoProgramAccess
        programs={(await listProgramsForUser(session.sub)).map((r) => ({
          id: r.id,
          name: r.name,
        }))}
      />
    );
  const vault = row.program.vaultAddress as Address | null;
  const paused = vault
    ? await readVault(vault)
        .then((v) => v.paused)
        .catch(() => false)
    : false;
  return (
    <>
      {paused ? <VaultPausedBanner programId={id} owner={row.role === "owner"} /> : null}
      {children}
    </>
  );
}
