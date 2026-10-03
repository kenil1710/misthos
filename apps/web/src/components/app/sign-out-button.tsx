"use client";

import { Button } from "@/components/ui/button";

export function SignOutButton({
  kind,
  className,
}: {
  kind: "owner" | "contributor";
  className?: string;
}) {
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
        // A full load of the landing page: wallet state and cached app pages are dropped with the session.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is the point
        window.location.assign(`/?signed_out=${kind}`);
      }}
    >
      Sign out
    </Button>
  );
}
