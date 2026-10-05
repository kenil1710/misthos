import { notFound } from "next/navigation";
import { getPublicProgramCached as getPublicProgram } from "@/lib/server/public-cached";
import { draftPreviewFor } from "@/lib/server/preview";

/**
 * Checks the program exists before the audit page's loading.tsx starts streaming: a layout renders outside that
 * boundary, so an unknown program answers with a real 404 status (the page's own check would come too late, after
 * the 200 is sent). Drafts pass for their owner, who sees a preview.
 */
export default async function PublicProgramLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await getPublicProgram(slug)) && !(await draftPreviewFor(slug))) notFound();
  return children;
}
