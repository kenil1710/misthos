"use client";

/** Shown wherever the wallet cooldown can be set: 0 removes the protection against hijacked payout wallets. */
export function CooldownWarning({ hours }: { hours: string }) {
  if (hours.trim() === "" || Number(hours) !== 0) return null;
  return (
    <p role="status" className="bg-warning-subtle text-warning rounded-md px-3 py-2 text-sm">
      With no cooldown, a payout wallet changed by someone who took over a contributor&apos;s
      account could be paid immediately. 24 hours is the recommended minimum.
    </p>
  );
}
