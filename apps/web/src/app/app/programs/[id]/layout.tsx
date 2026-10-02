import { notFound } from "next/navigation";
import { z } from "zod";
import { ProgramTabs } from "@/components/app/program-tabs";
import { getProgramForMember } from "@/lib/server/queries";
import { getOwnerSession } from "@/lib/server/session";

export default async function ProgramLayout({
  children,
  params,
}: LayoutProps<"/app/programs/[id]">) {
  const session = await getOwnerSession();
  if (!session) return children; // the /app layout renders sign-in
  const { id } = await params;
  if (!z.uuid().safeParse(id).success || !(await getProgramForMember(id, session.sub))) notFound();
  return (
    <>
      <ProgramTabs programId={id} />
      {children}
    </>
  );
}
