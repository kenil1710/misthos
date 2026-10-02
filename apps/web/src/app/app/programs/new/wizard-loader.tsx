"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** The wizard restores a locally saved draft on its first render, so it renders in the browser only. */
export const WizardLoader = dynamic(() => import("./wizard").then((m) => m.ProgramWizard), {
  ssr: false,
  loading: () => (
    <div className="mt-8 grid max-w-[640px] gap-4" aria-busy="true">
      <Skeleton className="h-6 w-80" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-24" />
    </div>
  ),
});
