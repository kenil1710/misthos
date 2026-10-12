import { redirect } from "next/navigation";
import { AllPrograms } from "@/components/app/all-programs";
import { joinedPrograms } from "@/lib/server/joined";
import { selectedNetwork } from "@/lib/server/network";
import { programSummaries } from "@/lib/server/program-summary";
import { getContributorSession, getOwnerSession } from "@/lib/server/session";

export const metadata = { title: "Your programs" };

/** Every program, always as a list (the /app entry jumps straight into a single program instead). */
export default async function ProgramsPage() {
  const session = await getOwnerSession();
  if (!session) return null;
  const [all, contributor, network] = await Promise.all([
    programSummaries(session.sub),
    getContributorSession(),
    selectedNetwork(),
  ]);
  // The header's network only; nothing there → the overview explains and offers the other network.
  const summaries = all.filter((s) => s.program.chain === network);
  if (!summaries.length) redirect("/app");
  const joined = contributor ? await joinedPrograms(contributor.xid, network) : [];
  return <AllPrograms summaries={summaries} joined={joined} />;
}
