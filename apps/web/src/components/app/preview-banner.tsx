import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Shown to a program's team on its public pages before it's published: only they can see the page. */
export function PreviewBanner({ programId, what }: { programId: string; what: string }) {
  return (
    <div
      role="status"
      className="bg-warning-subtle flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 text-sm sm:px-6"
    >
      <span>
        Preview: this {what} isn&apos;t public yet. Only your team can see it until you publish the
        program.
      </span>
      <Button asChild size="sm" variant="outline">
        <Link href={`/app/programs/${programId}`}>Go to the program</Link>
      </Button>
    </div>
  );
}
