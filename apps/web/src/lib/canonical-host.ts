/**
 * Misthos lives at one origin. Old and alternate hosts answer with a permanent redirect that keeps the path and
 * query, so sessions, SIWE messages and OAuth callbacks only ever see the canonical origin.
 */
export const CANONICAL_ORIGIN = "https://misthos.world";
export const LEGACY_HOSTS = ["misthos-iota.vercel.app", "www.misthos.world"] as const;

/** Next.js `redirects()` entries: one per legacy host, path and query kept, 308. */
export function canonicalRedirects(origin: string = CANONICAL_ORIGIN) {
  return LEGACY_HOSTS.map((host) => ({
    source: "/:path*",
    has: [{ type: "host" as const, value: host }],
    destination: `${origin}/:path*`,
    permanent: true,
  }));
}
