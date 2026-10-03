/**
 * Crawl every internal link reachable from the main entry points, signed in as the seeded owner and contributor,
 * in a real browser (so client-rendered links count). Reports any link that answers 4xx/5xx.
 *
 *   SHOW_BASE=http://localhost:3200 pnpm --filter @misthos/web exec tsx scripts/crawl.mts
 *
 * Exits 1 if any link is broken. Writes CRAWL_OUT (default docs/test-results/crawl.json).
 */
import nextEnv from "@next/env";
import { chromium } from "@playwright/test";
import { SignJWT } from "jose";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
nextEnv.loadEnvConfig(root);
const BASE = process.env.SHOW_BASE ?? "http://localhost:3200";
const OUT = path.join(root, process.env.CRAWL_OUT ?? "docs/test-results/crawl.json");
const MAX = Number(process.env.CRAWL_MAX ?? 400);
const show = JSON.parse(
  readFileSync(path.join(root, "apps/worker/scripts/.showcase.json"), "utf8"),
) as {
  programId: string;
  setupProgramId: string;
  slug: string;
  ownerUserId: string;
  owner: string;
  contributor: { userId: string; xid: string };
};
const key = new TextEncoder().encode(process.env.SESSION_SECRET!);
const token = (c: Record<string, unknown>) =>
  new SignJWT(c)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("misthos")
    .setExpirationTime("2h")
    .sign(key);

// Links that leave the site or end the session aren't followed (their status is still checked without redirects).
const NO_FOLLOW = [/^\/api\//];
const SKIP = [/^\/api\/auth\/logout/];

const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: BASE });
// CRAWL_OWNER="<userId>,<wallet>" and CRAWL_CONTRIBUTOR="<userId>,<xid>,<handle>" crawl as other accounts.
const [oSub, oAddr] = process.env.CRAWL_OWNER?.split(",") ?? [show.ownerUserId, show.owner];
const [cSub, cXid, cHandle] = process.env.CRAWL_CONTRIBUTOR?.split(",") ?? [
  show.contributor.userId,
  show.contributor.xid,
  "alice_builds",
];
if (!process.env.CRAWL_ANON)
  await ctx.addCookies([
    {
      name: "misthos_owner",
      value: await token({ sub: oSub, kind: "owner", addr: oAddr!.toLowerCase() }),
      url: BASE,
    },
    {
      name: "misthos_contributor",
      value: await token({ sub: cSub, kind: "contributor", xid: cXid, xh: cHandle }),
      url: BASE,
    },
  ]);
const page = await ctx.newPage();

const start = process.env.CRAWL_START?.split(",") ?? [
  "/",
  "/app",
  `/app/programs/${show.programId}`,
  `/app/programs/${show.setupProgramId}`,
  `/c/${show.slug}`,
  `/join/${show.slug}`,
  `/p/${show.slug}`,
  "/docs",
];
const queue = [...start];
const seen = new Map<string, { status: number; from: string }>();
const from = new Map<string, string>(start.map((s) => [s, "(start)"]));
const broken: { url: string; status: number; from: string }[] = [];

while (queue.length && seen.size < MAX) {
  const url = queue.shift()!;
  if (seen.has(url)) continue;
  const parent = from.get(url) ?? "?";
  if (NO_FOLLOW.some((r) => r.test(url))) {
    const res = await ctx.request.get(url, { maxRedirects: 0, failOnStatusCode: false });
    seen.set(url, { status: res.status(), from: parent });
    if (res.status() >= 400) broken.push({ url, status: res.status(), from: parent });
    continue;
  }
  const res = await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 })
    .catch((e: Error) => (console.log(`  ! ${url}: ${e.message.split("\n")[0]}`), null));
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  const status = res?.status() ?? 0;
  seen.set(url, { status, from: parent });
  if (status === 0 || status >= 400) {
    broken.push({ url, status, from: parent });
    continue;
  }
  const hrefs = await page.$$eval("a[href]", (as) =>
    as.map((a) => (a as HTMLAnchorElement).href).filter(Boolean),
  );
  for (const h of hrefs) {
    const u = new URL(h, BASE);
    if (u.origin !== new URL(BASE).origin) continue;
    const p = u.pathname + u.search;
    if (SKIP.some((r) => r.test(p))) continue;
    // Programs other than the seeded ones (e.g. leftover QA programs) would explode the crawl.
    if (!seen.has(p) && !queue.includes(p)) {
      queue.push(p);
      from.set(p, url);
    }
  }
}
await browser.close();

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    { base: BASE, checked: seen.size, broken, pages: Object.fromEntries(seen) },
    null,
    2,
  ),
);
console.log(`checked ${seen.size} internal URLs`);
for (const b of broken) console.log(`BROKEN ${b.status} ${b.url}  (linked from ${b.from})`);
if (!broken.length) console.log("no broken links");
process.exit(broken.length ? 1 : 0);
