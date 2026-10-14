import { PageSkeleton } from "@/components/ui-kit/skeletons";

export default function Loading() {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <PageSkeleton stats={0} rows={4} />
    </main>
  );
}
