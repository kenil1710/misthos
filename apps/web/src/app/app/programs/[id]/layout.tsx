import { notFound } from "next/navigation";
import { z } from "zod";
import { VaultPausedBanner } from "@/components/app/vault-paused-banner";
import { getProgramForMember } from "@/lib/server/queries";
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
  if (!row) notFound();
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
