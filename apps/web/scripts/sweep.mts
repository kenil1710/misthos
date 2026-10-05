/**
 * "Fresh eyes" sweep: every page for every role, at 375 and 1440 px, light and dark, against a running build with
 * real data. Read-only: it only navigates (and opens drawers); it never submits forms or signs anything.
 *
 * Per page it records console errors/warnings, page errors (incl. hydration), failed requests (4xx/5xx, network),
 * the tab title, horizontal overflow, axe violations (1440 px, both themes) and every date/time string shown, and
 * saves a full-page screenshot to SWEEP_OUT/<name>-<width>-<theme>.png. Report: SWEEP_OUT/report.json.
 *
 *   NEXT_DIST_DIR=.next-sweep pnpm build && NEXT_DIST_DIR=.next-sweep pnpm exec next start -p 3300
 *   SWEEP_BASE=http://localhost:3300 pnpm --filter @misthos/web exec tsx scripts/sweep.mts
 *
 * Sessions are minted with the local SESSION_SECRET, so this only works against a server using the same secret
 * (a local build), never production. SWEEP_ONLY=name1,name2 limits the pages.
 */
import AxeBuilder from "@axe-core/playwright";
import { createDb } from "@misthos/db";
import nextEnv from "@next/env";
import { chromium, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
nextEnv.loadEnvConfig(root);
const BASE = process.env.SWEEP_BASE ?? "http://localhost:3300";
const OUT = path.resolve(process.env.SWEEP_OUT ?? path.join(root, "private/ux-sweep/before"));
const ONLY = process.env.SWEEP_ONLY?.split(",");
const WIDTHS = (process.env.SWEEP_WIDTHS ?? "1440,375").split(",").map(Number);
const THEMES = (process.env.SWEEP_THEMES ?? "light,dark").split(",") as ("light" | "dark")[];
mkdirSync(OUT, { recursive: true });

// ── Real ids (read-only) ──────────────────────────────────────────────
const { pool } = createDb(process.env.DATABASE_URL!, { max: 1 });
const one = async <T,>(sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0] as T;
const kency = await one<{ id: string; owner_id: string; wallet: string }>(
  `select p.id, pm.user_id owner_id, u.wallet_address wallet from programs p join program_members pm on pm.program_id = p.id and pm.role = 'owner' join users u on u.id = pm.user_id where p.slug = 'kency-arc-creators'`,
);
const kRounds = (await pool.query(`select id, number from rounds where program_id = $1 order by number`, [kency.id])).rows as { id: string }[];
const kContributor = await one<{ id: string; user_id: string; x_user_id: string; x_handle: string }>(
  `select id, user_id, x_user_id, x_handle from contributors where program_id = $1 limit 1`,
  [kency.id],
);
const qa = await one<{ id: string; slug: string; owner_id: string; wallet: string }>(
  `select p.id, p.slug, pm.user_id owner_id, u.wallet_address wallet from programs p join program_members pm on pm.program_id = p.id and pm.role = 'owner' join users u on u.id = pm.user_id where p.slug = 'qa-0996031'`,
);
const qaRound = await one<{ id: string }>(
  `select id from rounds where program_id = $1 and status = 'executed' order by number limit 1`,
  [qa.id],
);
const qaContributor = await one<{ id: string; user_id: string; x_user_id: string; x_handle: string }>(
  `select c.id, c.user_id, c.x_user_id, c.x_handle from contributors c where c.program_id = $1 order by (select count(*) from submissions s where s.contributor_id = c.id) desc limit 1`,
  [qa.id],
);
const qaSub = await one<{ id: string }>(
  `select s.id from submissions s where s.program_id = $1 and s.status = 'escalated' limit 1`,
  [qa.id],
);
const draft = await one<{ id: string; owner_id: string; wallet: string; slug: string }>(
  `select p.id, p.slug, pm.user_id owner_id, u.wallet_address wallet from programs p join program_members pm on pm.program_id = p.id and pm.role = 'owner' join users u on u.id = pm.user_id where p.status = 'draft' limit 1`,
);
await pool.end();

const key = new TextEncoder().encode(process.env.SESSION_SECRET!);
const jwt = (c: Record<string, unknown>) =>
  new SignJWT(c).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setIssuer("misthos").setExpirationTime("2h").sign(key);
const SESSIONS = {
  owner: { misthos_owner: await jwt({ sub: kency.owner_id, kind: "owner", addr: kency.wallet }) },
  qaOwner: { misthos_owner: await jwt({ sub: qa.owner_id, kind: "owner", addr: qa.wallet }) },
  draftOwner: { misthos_owner: await jwt({ sub: draft.owner_id, kind: "owner", addr: draft.wallet }) },
  contributor: {
    misthos_contributor: await jwt({ sub: kContributor.user_id, kind: "contributor", xid: kContributor.x_user_id, xh: kContributor.x_handle }),
  },
  qaContributor: {
    misthos_contributor: await jwt({ sub: qaContributor.user_id, kind: "contributor", xid: qaContributor.x_user_id, xh: qaContributor.x_handle }),
  },
  anon: {},
} as const;
type Who = keyof typeof SESSIONS;

const P = `/app/programs/${kency.id}`;
const Q = `/app/programs/${qa.id}`;
const PAGES: { name: string; path: string; who: Who; click?: string }[] = [
  { name: "landing", path: "/", who: "anon" },
  { name: "docs", path: "/docs", who: "anon" },
  { name: "docs-agent", path: "/docs/how-the-agent-decides", who: "anon" },
  { name: "docs-quickstart", path: "/docs/quickstart", who: "anon" },
  { name: "public-audit", path: "/p/kency-arc-creators", who: "anon" },
  { name: "public-round", path: `/p/kency-arc-creators/rounds/${kRounds[0]!.id}`, who: "anon" },
  { name: "public-audit-qa", path: `/p/${qa.slug}`, who: "anon" },
  { name: "join-anon", path: "/join/kency-arc-creators", who: "anon" },
  { name: "join-member", path: "/join/kency-arc-creators", who: "contributor" },
  { name: "not-found", path: "/this-does-not-exist", who: "anon" },
  { name: "audit-not-found", path: "/p/no-such-program", who: "anon" },
  { name: "owner-sign-in", path: "/app", who: "anon" },
  { name: "owner-home", path: "/app", who: "owner" },
  { name: "owner-programs", path: "/app/programs", who: "owner" },
  { name: "overview", path: P, who: "owner" },
  { name: "submissions", path: `${P}/submissions`, who: "owner" },
  { name: "submissions-board", path: `${P}/submissions?view=board`, who: "owner" },
  { name: "rounds", path: `${P}/rounds`, who: "owner" },
  { name: "round-executed", path: `${P}/rounds/${kRounds[0]!.id}`, who: "owner" },
  { name: "round-open", path: `${P}/rounds/${kRounds[1]!.id}`, who: "owner" },
  { name: "treasury", path: `${P}/treasury`, who: "owner" },
  { name: "contributors", path: `${P}/contributors`, who: "owner" },
  { name: "contributor-detail", path: `${P}/contributors/${kContributor.id}`, who: "owner" },
  { name: "audit-log", path: `${P}/audit`, who: "owner" },
  { name: "settings", path: `${P}/settings`, who: "owner" },
  { name: "setup-live", path: `${P}/setup`, who: "owner" },
  { name: "ready", path: `${P}/ready`, who: "owner" },
  { name: "wizard", path: "/app/programs/new", who: "owner" },
  { name: "metrics", path: "/app/admin/metrics", who: "owner" },
  { name: "qa-home", path: "/app", who: "qaOwner" },
  { name: "qa-programs", path: "/app/programs", who: "qaOwner" },
  { name: "qa-overview", path: Q, who: "qaOwner" },
  { name: "qa-submissions", path: `${Q}/submissions`, who: "qaOwner" },
  { name: "qa-drawer", path: `${Q}/submissions`, who: "qaOwner", click: "Review submission" },
  { name: "qa-rounds", path: `${Q}/rounds`, who: "qaOwner" },
  { name: "qa-round", path: `${Q}/rounds/${qaRound.id}`, who: "qaOwner" },
  { name: "qa-contributors", path: `${Q}/contributors`, who: "qaOwner" },
  { name: "draft-overview", path: `/app/programs/${draft.id}`, who: "draftOwner" },
  { name: "draft-setup", path: `/app/programs/${draft.id}/setup`, who: "draftOwner" },
  { name: "contributor-home", path: "/c", who: "contributor" },
  { name: "contributor-program", path: "/c/kency-arc-creators", who: "contributor" },
  { name: "qa-contributor-home", path: "/c", who: "qaContributor" },
  { name: "qa-contributor-program", path: `/c/${qa.slug}`, who: "qaContributor" },
  { name: "contributor-signed-out", path: "/c", who: "anon" },
  { name: "other-owner-program", path: Q, who: "owner" },
];
void qaSub;

// Every date/time-looking string, to compare formats across pages.
const DATE_RE =
  /\b(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:\s?UTC)?|\d{1,2}:\d{2}(?:\s?[AP]M)?(?:\s?UTC)?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:, \d{4})?(?:,? \d{1,2}:\d{2}(?:\s?[AP]M)?)?|\d+ (?:minutes?|hours?|days?|weeks?) ago|in \d+ (?:minutes?|hours?|days?))\b/g;

type Row = {
  name: string;
  path: string;
  who: Who;
  width: number;
  theme: string;
  status: number | null;
  finalUrl: string;
  title: string;
  overflowX: number;
  console: string[];
  failed: string[];
  axe?: { id: string; impact: string | null | undefined; nodes: number; help: string; targets: string[] }[];
  dates: string[];
};
const rows: Row[] = [];

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
}

const browser = await chromium.launch();
for (const pg of PAGES.filter((p) => !ONLY || ONLY.includes(p.name))) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({
        baseURL: BASE,
        colorScheme: theme,
        viewport: { width, height: width < 600 ? 812 : 900 },
        deviceScaleFactor: 1,
      });
      await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
      await ctx.addCookies(
        Object.entries(SESSIONS[pg.who]).map(([name, value]) => ({ name, value, url: BASE })),
      );
      const page = await ctx.newPage();
      const consoleMsgs: string[] = [];
      const failed: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 300)}`);
      });
      page.on("pageerror", (e) => consoleMsgs.push(`pageerror: ${e.message.slice(0, 300)}`));
      page.on("response", (r) => {
        if (r.status() >= 400 && !r.url().includes("favicon")) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
      });
      page.on("requestfailed", (r) => {
        const why = r.failure()?.errorText ?? "";
        if (!/ERR_ABORTED/.test(why)) failed.push(`failed ${r.method()} ${r.url().replace(BASE, "")} ${why}`);
      });
      const res = await page.goto(pg.path, { waitUntil: "domcontentloaded" }).catch(() => null);
      await settle(page);
      if (pg.click) {
        await page.getByRole("button", { name: new RegExp(pg.click) }).first().click().catch(() => {});
        await page.getByRole("dialog").waitFor({ timeout: 5000 }).catch(() => {});
        await settle(page);
      }
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const text = await page.evaluate(() => document.body.innerText);
      const row: Row = {
        name: pg.name,
        path: pg.path,
        who: pg.who,
        width,
        theme,
        status: res?.status() ?? null,
        finalUrl: page.url().replace(BASE, ""),
        title: await page.title(),
        overflowX,
        console: consoleMsgs,
        failed,
        dates: [...new Set(text.match(DATE_RE) ?? [])],
      };
      if (width === 1440) {
        const r = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
          .analyze();
        row.axe = r.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
          help: v.help,
          targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
        }));
      }
      await page.screenshot({ path: path.join(OUT, `${pg.name}-${width}-${theme}.png`), fullPage: !pg.click });
      rows.push(row);
      const flags = [
        row.status && row.status >= 400 ? `HTTP ${row.status}` : "",
        overflowX > 0 ? `overflow ${overflowX}px` : "",
        consoleMsgs.length ? `${consoleMsgs.length} console` : "",
        failed.length ? `${failed.length} failed req` : "",
        row.axe?.length ? `axe ${row.axe.map((a) => `${a.id}:${a.impact}`).join(",")}` : "",
      ].filter(Boolean);
      console.log(`${flags.length ? "!!" : "ok"} ${pg.name.padEnd(24)} ${String(width).padEnd(4)} ${theme.padEnd(5)} "${row.title}" ${flags.join(" | ")}`);
      await ctx.close();
    }
  }
}
await browser.close();
writeFileSync(path.join(OUT, "report.json"), JSON.stringify(rows, null, 2));
