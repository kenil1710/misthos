import { WizardLoader } from "./wizard-loader";
import { STEPS } from "./wizard-steps";

export const metadata = { title: "New program" };

/** Full-screen guided flow (no app rail; see FOCUS_ROUTES): the wizard draws its own header and progress. */
export default async function NewProgramPage({ searchParams }: PageProps<"/app/programs/new">) {
  const raw = Number((await searchParams).step);
  // The wizard may still step back to the first invalid step once the draft is restored.
  const step = Math.min(STEPS.length, Math.max(1, Number.isFinite(raw) ? raw : 1)) - 1;
  return <WizardLoader step={step} />;
}
