import { ProgramWizard } from "./wizard";

export const metadata = { title: "New program" };

export default function NewProgramPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">New program</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Set the rules once. The agent applies them to every submission, and the vault enforces the
        limits on-chain.
      </p>
      <ProgramWizard />
    </div>
  );
}
