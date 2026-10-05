"use client";

import { Button } from "@/components/ui/button";

/** End the session and do a full load of the landing page (wallet state and cached app pages go with it). */
export async function signOut(kind: "owner" | "contributor") {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is the point
  window.location.assign(`/?signed_out=${kind}`);
}

export function SignOutButton({
  kind,
  className,
}: {
  kind: "owner" | "contributor";
  className?: string;
}) {
  return (
    <Button variant="ghost" size="sm" className={className} onClick={() => signOut(kind)}>
      Sign out
    </Button>
  );
}
