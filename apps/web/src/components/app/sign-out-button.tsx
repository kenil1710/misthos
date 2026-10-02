"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SignOutButton({
  kind,
  className,
}: {
  kind: "owner" | "contributor";
  className?: string;
}) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={async () => {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
        });
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
