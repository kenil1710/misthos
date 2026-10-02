import { PageHeader } from "@/components/ui-kit";
import { ProgramWizard } from "./wizard";

export const metadata = { title: "New program" };

export default function NewProgramPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        crumbs={[{ label: "All programs", href: "/app" }, { label: "New program" }]}
        title="New program"
        description="Set the rules once. The agent applies them to every submission, and the vault enforces the limits on-chain. Nothing is published or spent until you choose to."
      />
      <ProgramWizard />
    </div>
  );
}
