import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { VaultPausedBanner } from "@/components/app/vault-paused-banner";
import { NoProgramAccess } from "@/components/app/no-access";
import { getProgramForMember, listProgramsForUser } from "@/lib/server/queries";
import { getOwnerSession } from "@/lib/server/session";
import { readVault } from "@/lib/server/vault";
import { ProgramNetwork } from "@/components/web3/network";
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
  return (
    // Wallet actions, "wrong network" checks and explorer links on this program's pages use its network.
    <ProgramNetwork chain={row.program.chain}>
      {vault ? (
        // The vault read is an RPC call: stream the banner in rather than hold up the page.
        <Suspense fallback={null}>
          <PausedBanner
            vault={vault}
            chain={row.program.chain}
            programId={id}
            owner={row.role === "owner"}
          />
        </Suspense>
      ) : null}
      {children}
    </ProgramNetwork>
  );
}

async function PausedBanner({
  vault,
  chain,
  programId,
  owner,
}: {
  vault: Address;
  chain: string;
  programId: string;
  owner: boolean;
}) {
  const paused = await readVault(vault, chain)
    .then((v) => v.paused)
    .catch(() => false);
  return paused ? <VaultPausedBanner programId={programId} owner={owner} /> : null;
}
