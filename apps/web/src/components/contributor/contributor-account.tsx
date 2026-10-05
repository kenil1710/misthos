"use client";

import { Layers } from "lucide-react";
import Link from "next/link";
import { AccountChip } from "@/components/app/account-chip";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/** The contributor's account chip for page headers: their X handle, the programs they joined, sign out. No wallet. */
export function ContributorAccount({ handle }: { handle: string }) {
  return (
    <AccountChip
      kind="contributor"
      handle={handle}
      align="end"
      side="bottom"
      className="max-w-48"
      extraItems={
        <DropdownMenuItem asChild>
          <Link href="/c">
            <Layers className="size-4" strokeWidth={1.5} />
            Programs you joined
          </Link>
        </DropdownMenuItem>
      }
    />
  );
}
