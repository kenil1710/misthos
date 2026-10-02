import type { Address } from "viem";
import { LimitsForm } from "@/components/vault/limits-form";
import { unitsToInput } from "@/lib/units";
import { getProgramForMember } from "@/lib/server/queries";
import { getOwnerSession } from "@/lib/server/session";
import { readVault } from "@/lib/server/vault";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/app/programs/[id]/settings">) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { id } = await params;
  const row = await getProgramForMember(id, session.sub);
  if (!row) return null;
  if (row.role !== "owner")
    return (
      <p className="text-muted-foreground text-sm">Only the program owner can change settings.</p>
    );
  const vault = row.program.vaultAddress as Address | null;
  const l = vault ? (await readVault(vault)).limits : null;
  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Vault limits</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          These are enforced by the vault contract. Changing them is a transaction from your wallet;
          proposals already waiting are re-checked against the new limits before they execute.
        </p>
      </div>
      {vault && l ? (
        <LimitsForm
          programId={id}
          vault={vault}
          owner={session.addr as Address}
          current={{
            maxPerPayout: unitsToInput(l.maxPerPayout),
            maxPerRound: unitsToInput(l.maxPerRound),
            maxPerDay: unitsToInput(l.maxPerDay),
            autoApproveThreshold: unitsToInput(l.autoApproveThreshold),
            payeeCooldownHours: String(Number(l.payeeCooldown) / 3600),
          }}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          Deploy the vault from the Overview tab first.
        </p>
      )}
    </div>
  );
}
