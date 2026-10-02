import { PauseCircle } from "lucide-react";
import Link from "next/link";

/** Shown on every program page while the vault is paused, because nothing can be paid until it resumes. */
export function VaultPausedBanner({ programId, owner }: { programId: string; owner: boolean }) {
  return (
    <div
      role="status"
      className="bg-warning-subtle text-warning mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-4 py-3 text-sm"
    >
      <PauseCircle className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      <span className="flex-1">
        The vault is paused. No rounds can be paid and no new payout wallets can be registered.
      </span>
      {owner ? (
        <Link
          href={`/app/programs/${programId}/treasury#vault-controls`}
          className="font-medium underline underline-offset-4"
        >
          Resume in Treasury
        </Link>
      ) : null}
    </div>
  );
}
