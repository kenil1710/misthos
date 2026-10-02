import { Suspense } from "react";
import { PageHeader } from "@/components/ui-kit";
import { WizardLoader } from "./wizard-loader";

export const metadata = { title: "New program" };

export default function NewProgramPage() {
  return (
    <div>
      <PageHeader
        crumbs={[{ label: "All programs", href: "/app" }, { label: "New program" }]}
        title="New program"
        description="Set the rules once. The agent applies them to every submission, and the vault enforces the limits on-chain. Nothing is published or spent until you choose to."
      />
      <Suspense>
        <WizardLoader />
      </Suspense>
    </div>
  );
}
