"use client";

import { ErrorPanel } from "@/components/ui-kit/error-panel";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <ErrorPanel reset={reset} />;
}
