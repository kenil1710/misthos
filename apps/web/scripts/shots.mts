/**
 * Screenshots of the main pages for the showcase stack, signed in as the seeded owner / contributor where needed.
 *
 *   SHOTS_DIR=docs/screenshots/contributor-fixes/before SHOW_BASE=http://localhost:3200 \
 *     pnpm --filter @misthos/web exec tsx scripts/shots.mts
 *
 * SHOTS_WIDTHS (default "1440,375") and SHOTS_THEMES (default "light") pick the matrix; files are named
 * `<page>-<width>-<theme>.png`. Prints any page that overflows horizontally.
 */
import nextEnv from "@next/env";
import { chromium, type Browser } from "@playwright/test";
import { SignJWT } from "jose";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
nextEnv.loadEnvConfig(root);
const BASE = process.env.SHOW_BASE ?? "http://localhost:3200";
const OUT = path.join(root, process.env.SHOTS_DIR ?? "docs/screenshots/contributor-fixes/after");
const WIDTHS = (process.env.SHOTS_WIDTHS ?? "1440,375").split(",").map(Number);
const THEMES = (process.env.SHOTS_THEMES ?? "light").split(",") as ("light" | "dark")[];
const ONLY = process.env.SHOTS_ONLY?.split(",");
mkdirSync(OUT, { recursive: true });
const show = JSON.parse(
  readFileSync(path.join(root, "apps/worker/scripts/.showcase.json"), "utf8"),
) as {
  programId: string;
  setupProgramId: string;
  slug: string;
  ownerUserId: string;
  owner: string;
  contributor: { userId: string; xid: string };
  round1: string;
};
const key = new TextEncoder().encode(process.env.SESSION_SECRET!);
const token = (c: Record<string, unknown>) =>
  new SignJWT(c)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("misthos")
    .setExpirationTime("2h")
    .sign(key);

type Who = "anon" | "owner" | "contributor" | "both";
const PAGES: { name: string; path: string; who: Who }[] = [
  { name: "landing-signed-in", path: "/", who: "both" },
  { name: "landing", path: "/", who: "anon" },
  { name: "home", path: "/app", who: "both" },
  { name: "program-overview", path: `/app/programs/${show.programId}`, who: "owner" },
  { name: "program-overview-new", path: `/app/programs/${show.setupProgramId}`, who: "owner" },
  { name: "submissions", path: `/app/programs/${show.programId}/submissions`, who: "owner" },
  { name: "rounds", path: `/app/programs/${show.programId}/rounds`, who: "owner" },
  { name: "treasury", path: `/app/programs/${show.programId}/treasury`, who: "owner" },
  { name: "settings", path: `/app/programs/${show.programId}/settings`, who: "owner" },
  { name: "audit-log", path: `/app/programs/${show.programId}/audit`, who: "owner" },
  { name: "wizard", path: "/app/programs/new", who: "owner" },
  { name: "contributor-home", path: `/c/${show.slug}`, who: "contributor" },
  { name: "join", path: `/join/${show.slug}`, who: "anon" },
  { name: "join-signed-in", path: `/join/${show.slug}`, who: "contributor" },
  { name: "public-audit", path: `/p/${show.slug}`, who: "anon" },
  { name: "round-receipt", path: `/p/${show.slug}/rounds/${show.round1}`, who: "anon" },
  { name: "docs", path: "/docs", who: "anon" },
  { name: "not-found", path: "/this-page-does-not-exist", who: "anon" },
];

async function cookies(who: Who) {
  const url = BASE;
  const out: { name: string; value: string; url: string }[] = [];
  if (who === "owner" || who === "both")
    out.push({
      name: "misthos_owner",
      value: await token({ sub: show.ownerUserId, kind: "owner", addr: show.owner.toLowerCase() }),
      url,
    });
  if (who === "contributor" || who === "both")
    out.push({
      name: "misthos_contributor",
      value: await token({
        sub: show.contributor.userId,
        kind: "contributor",
        xid: show.contributor.xid,
        xh: "alice_builds",
      }),
      url,
    });
  return out;
}

const overflow: string[] = [];
async function run(browser: Browser) {
  for (const theme of THEMES)
    for (const width of WIDTHS)
      for (const p of PAGES) {
        if (ONLY && !ONLY.includes(p.name)) continue;
        const ctx = await browser.newContext({
          viewport: { width, height: 900 },
          deviceScaleFactor: width < 800 ? 2 : 1,
          colorScheme: theme,
          baseURL: BASE,
        });
        await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
        await ctx.addCookies(await cookies(p.who));
        const page = await ctx.newPage();
        await page.goto(p.path, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        const wide = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        if (wide) overflow.push(`${p.name} @${width} ${theme}`);
        const file = `${p.name}-${width}-${theme}.png`;
        await page.screenshot({ path: path.join(OUT, file), fullPage: true });
        console.log("  ", file, page.url().replace(BASE, ""));
        await ctx.close();
      }
}

const browser = await chromium.launch();
try {
  await run(browser);
} finally {
  await browser.close();
}
writeFileSync(path.join(OUT, "overflow.json"), JSON.stringify(overflow, null, 2));
console.log(overflow.length ? `horizontal overflow: ${overflow.join("; ")}` : "no horizontal overflow");
