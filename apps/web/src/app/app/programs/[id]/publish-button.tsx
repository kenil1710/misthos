"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setProgramStatusAction } from "../actions";

/** Open or close the public join page. Reversible, so no confirmation; the result is confirmed with a toast. */
export function PublishButton({
  programId,
  status,
  size = "sm",
}: {
  programId: string;
  status: "draft" | "active" | "paused" | "archived";
  size?: "sm" | "default";
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (status === "archived") return null;
  const next = status === "active" ? "paused" : "active";
  return (
    <Button
      variant={status === "active" ? "outline" : "default"}
      size={size}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setProgramStatusAction(programId, next);
          if (res.ok)
            toast.success(
              next === "active"
                ? "Join page is open. Share the link."
                : "Joining paused. Existing contributors can still submit.",
            );
          else toast.error("Couldn't change the program. Sign in again and retry.");
          router.refresh();
        })
      }
    >
      {pending
        ? "Saving…"
        : status === "active"
          ? "Pause joining"
          : status === "paused"
            ? "Reopen joining"
            : "Publish join page"}
    </Button>
  );
}
