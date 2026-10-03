import { redirect } from "next/navigation";
import { AllPrograms } from "@/components/app/all-programs";
import { joinedPrograms } from "@/lib/server/joined";
import { programSummaries } from "@/lib/server/program-summary";
import { getContributorSession, getOwnerSession } from "@/lib/server/session";

export const metadata = { title: "Your programs" };

/** Every program, always as a list (the /app entry jumps straight into a single program instead). */
export default async function ProgramsPage() {
  const session = await getOwnerSession();
  if (!session) return null;
  const [summaries, contributor] = await Promise.all([
    programSummaries(session.sub),
    getContributorSession(),
  ]);
  if (!summaries.length) redirect("/app");
  const joined = contributor ? await joinedPrograms(contributor.xid) : [];
  return <AllPrograms summaries={summaries} joined={joined} />;
}
