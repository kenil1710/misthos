/**
 * Small load test (autocannon) against a production build of the showcase stack: the public pages and the submit
 * API. The submit runs as a real contributor re-submitting a link they already sent, so every request goes through
 * session, origin and database checks without creating rows. Reports p50/p95/p99 latency, throughput and errors.
 *
 *   SHOW_BASE=http://localhost:3200 pnpm --filter @misthos/web exec tsx scripts/load.mts
 */
import nextEnv from "@next/env";
import autocannon from "autocannon";
import { SignJWT } from "jose";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
nextEnv.loadEnvConfig(root);
const BASE = process.env.SHOW_BASE ?? "http://localhost:3200";
const DURATION = Number(process.env.LOAD_SECONDS ?? 15);
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? 20);
const show = JSON.parse(readFileSync(path.join(root, "apps/worker/scripts/.showcase.json"), "utf8")) as {
  slug: string;
  contributor: { userId: string; xid: string };
};
const token = await new SignJWT({
  sub: show.contributor.userId,
  kind: "contributor",
  xid: show.contributor.xid,
  xh: "alice_builds",
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setIssuer("misthos")
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));

const targets = [
  { name: "Landing (/)", path: "/" },
  { name: "Join page", path: `/join/${show.slug}` },
  { name: "Public audit", path: `/p/${show.slug}` },
  {
    name: "Submit API (POST)",
    path: "/api/contributor/submissions",
    method: "POST" as const,
    headers: {
      cookie: `misthos_contributor=${token}`,
      origin: BASE,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      programSlug: show.slug,
      url: "https://x.com/i/web/status/1900000000000000001",
    }),
    // The expected answer is a clean 400 "already submitted" (or the daily cap); 5xx and timeouts are errors.
    okStatus: (s: number) => s < 500,
  },
];

const rows = [];
for (const t of targets) {
  const r = await autocannon({
    url: BASE + t.path,
    method: t.method ?? "GET",
    headers: t.headers,
    body: t.body,
    connections: CONNECTIONS,
    duration: DURATION,
  });
  const non2xx = r.non2xx;
  const errors = r.errors + r.timeouts + (t.okStatus ? r["5xx"] : non2xx);
  const row = {
    target: t.name,
    requests: r.requests.total,
    rps: Math.round(r.requests.average),
    p50ms: r.latency.p50,
    // autocannon has no p95 bucket: p90 and p97.5 bound it.
    p90ms: r.latency.p90,
    p97_5ms: r.latency.p97_5,
    p99ms: r.latency.p99,
    errors,
    statuses: { "2xx": r["2xx"], "4xx": r["4xx"], "5xx": r["5xx"] },
  };
  rows.push(row);
  console.log(
    `${t.name.padEnd(20)} ${String(row.requests).padStart(6)} req  ${String(row.rps).padStart(5)} req/s  p50 ${row.p50ms}ms  p90 ${row.p90ms}ms  p97.5 ${row.p97_5ms}ms  p99 ${row.p99ms}ms  errors ${errors}`,
  );
}
mkdirSync(path.join(root, "docs/perf"), { recursive: true });
writeFileSync(
  path.join(root, "docs/perf/load.json"),
  JSON.stringify({ base: BASE, durationS: DURATION, connections: CONNECTIONS, rows }, null, 2),
);
