/**
 * Lighthouse (mobile + desktop) on the five pages people land on most, against a production build of the showcase
 * stack. Signed-in pages get a session cookie for the seeded owner / contributor. Writes a JSON summary.
 *
 *   LH_BASE=http://localhost:3200 LH_OUT=docs/perf/lighthouse-before.json \
 *     pnpm --filter @misthos/web exec tsx scripts/lighthouse.mts
 */
import nextEnv from "@next/env";
import * as chromeLauncher from "chrome-launcher";
import { SignJWT } from "jose";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
nextEnv.loadEnvConfig(root);
const BASE = process.env.LH_BASE ?? "http://localhost:3200";
const OUT = path.join(root, process.env.LH_OUT ?? "docs/perf/lighthouse.json");
const RUNS = Number(process.env.LH_RUNS ?? 1);
const show = JSON.parse(
  readFileSync(path.join(root, "apps/worker/scripts/.showcase.json"), "utf8"),
) as {
  programId: string;
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

const ownerCookie = `misthos_owner=${await token({ sub: show.ownerUserId, kind: "owner", addr: show.owner.toLowerCase() })}`;
const contributorCookie = `misthos_contributor=${await token({
  sub: show.contributor.userId,
  kind: "contributor",
  xid: show.contributor.xid,
  xh: "alice_builds",
})}`;

const ONLY = process.env.LH_ONLY?.split(",");
const ALL_PAGES = [
  { name: "Landing", path: "/" },
  { name: "Join", path: `/join/${show.slug}` },
  { name: "Contributor home", path: `/c/${show.slug}`, cookie: contributorCookie },
  { name: "Public audit", path: `/p/${show.slug}` },
  { name: "Owner overview", path: `/app/programs/${show.programId}`, cookie: ownerCookie },
];
const PAGES = ALL_PAGES.filter((p) => !ONLY || ONLY.includes(p.name));
const CATS = ["performance", "accessibility", "best-practices", "seo"] as const;

type Row = {
  page: string;
  form: "mobile" | "desktop";
  scores: Record<string, number>;
  lcpMs: number;
  tbtMs: number;
  cls: number;
  jsKb: number;
  failing: string[];
};

const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-sandbox"] });
const rows: Row[] = [];
try {
  for (const page of PAGES) {
    for (const form of ["mobile", "desktop"] as const) {
      const runs: Row[] = [];
      for (let i = 0; i < RUNS; i++) {
        const r = await lighthouse(
          `${BASE}${page.path}`,
          {
            port: chrome.port,
            output: "json",
            logLevel: "error",
            onlyCategories: [...CATS],
            extraHeaders: page.cookie ? { Cookie: page.cookie } : undefined,
          },
          form === "desktop" ? desktopConfig : undefined,
        );
        const lhr = r!.lhr;
        const audit = (id: string) => lhr.audits[id]?.numericValue ?? 0;
        const js =
          (
            lhr.audits["resource-summary"]?.details as
              | { items?: { resourceType: string; transferSize: number }[] }
              | undefined
          )?.items?.find((x) => x.resourceType === "script")?.transferSize ?? 0;
        runs.push({
          page: page.name,
          form,
          scores: Object.fromEntries(
            CATS.map((c) => [c, Math.round((lhr.categories[c]?.score ?? 0) * 100)]),
          ),
          lcpMs: Math.round(audit("largest-contentful-paint")),
          tbtMs: Math.round(audit("total-blocking-time")),
          cls: Number(audit("cumulative-layout-shift").toFixed(3)),
          jsKb: Math.round(js / 1024),
          // Audits in the scored categories that didn't pass, so each regression names its cause.
          failing: CATS.flatMap((c) =>
            (lhr.categories[c]?.auditRefs ?? [])
              .filter((ref) => ref.weight > 0)
              .map((ref) => lhr.audits[ref.id]!)
              .filter((a) => a.score !== null && a.score < 0.9)
              .map((a) => `${c}:${a.id}${a.displayValue ? ` (${a.displayValue})` : ""}`),
          ),
        });
      }
      // Median run by performance score.
      runs.sort((a, b) => a.scores.performance! - b.scores.performance!);
      const row = runs[Math.floor(runs.length / 2)]!;
      rows.push(row);
      console.log(
        `${row.page.padEnd(17)} ${form.padEnd(8)} perf ${row.scores.performance} a11y ${row.scores.accessibility} bp ${row.scores["best-practices"]} seo ${row.scores.seo}  LCP ${row.lcpMs}ms TBT ${row.tbtMs}ms CLS ${row.cls} JS ${row.jsKb}KB`,
      );
      if (row.failing.length) console.log(`    failing: ${row.failing.join("; ")}`);
    }
  }
} finally {
  chrome.kill();
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 2));
console.log(`wrote ${path.relative(root, OUT)}`);
