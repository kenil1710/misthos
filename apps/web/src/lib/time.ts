/** "2026-10-02 09:37 UTC": the one absolute timestamp format used across the app. */
export const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** "just now", "12m ago", "3h ago", "2d ago", then the date. Pair with utc() as a hover title. */
export function relativeTime(d: Date, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return d.toISOString().slice(0, 10);
}

/** "2026-10-09" (UTC), for dates where the time of day doesn't matter. */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** "3 Oct, 12:00" in UTC: compact, for steppers and cards. */
export const shortUtc = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(d);
