"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ProgramTabs({ programId }: { programId: string }) {
  const path = usePathname();
  const base = `/app/programs/${programId}`;
  const tabs = [
    ["Overview", base],
    ["Rounds", `${base}/rounds`],
    ["Treasury", `${base}/treasury`],
    ["Settings", `${base}/settings`],
  ] as const;
  return (
    <nav
      aria-label="Program sections"
      className="-mt-4 mb-8 flex gap-1 overflow-x-auto border-b text-sm"
    >
      {tabs.map(([label, href]) => {
        const active = href === base ? path === base : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2",
              active
                ? "border-foreground text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
