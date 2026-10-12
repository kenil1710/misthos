import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/app/site-header";
import { Button } from "@/components/ui/button";
import { ProgramNetwork } from "@/components/web3/network";
import { getPublicProgramCached as getPublicProgram } from "@/lib/server/public-cached";
import { draftPreviewFor } from "@/lib/server/preview";

/**
 * Checks the program exists before the audit page's loading.tsx starts streaming: a layout renders outside that
 * boundary, so an unknown program answers with a real 404 status (the page's own check would come too late, after
 * the 200 is sent). Drafts pass for their owner, who sees a preview. The header shows the campaign's network.
 */
export default async function PublicProgramLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const program = (await getPublicProgram(slug)) ?? (await draftPreviewFor(slug));
  if (!program) notFound();
  return (
    <ProgramNetwork chain={program.chain}>
      <SiteHeader
        right={
          <Button asChild variant="ghost" size="sm">
            <Link href="/app">Run a program</Link>
          </Button>
        }
      />
      <main
        id="main"
        className="mx-auto grid w-full max-w-6xl flex-1 content-start grid-cols-[minmax(0,1fr)] gap-12 px-4 py-10 sm:px-6"
      >
        {children}
      </main>
    </ProgramNetwork>
  );
}
