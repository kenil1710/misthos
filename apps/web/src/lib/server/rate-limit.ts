import "server-only";

/** Small fixed-window limiter per key (per instance). Enough to keep public endpoints from being hammered. */
const windows = new Map<string, { start: number; count: number }>();

export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000)
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    return true;
  }
  w.count++;
  return w.count <= limit;
}

export function clientKey(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}
