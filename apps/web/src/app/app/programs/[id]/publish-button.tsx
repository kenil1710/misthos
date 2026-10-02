"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setProgramStatusAction } from "../actions";

export function PublishButton({
  programId,
  status,
}: {
  programId: string;
  status: "draft" | "active" | "paused" | "archived";
}) {
  const [pending, start] = useTransition();
  if (status === "archived") return null;
  const next = status === "active" ? "paused" : "active";
  return (
    <Button
      variant={status === "active" ? "outline" : "default"}
      size="sm"
      disabled={pending}
      onClick={() => start(async () => void (await setProgramStatusAction(programId, next)))}
    >
      {pending ? "Saving…" : status === "active" ? "Pause joining" : "Publish join page"}
    </Button>
  );
}
