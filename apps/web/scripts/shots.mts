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
const OUT = path.resolve(root, process.env.SHOTS_DIR ?? "docs/screenshots/contributor-fixes/after");
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

/** A filled wizard draft (what the wizard saves on the device), so later steps can be captured directly. */
const DRAFT = {
  savedAt: new Date().toISOString(),
  form: {
    basics: {
      name: "Arc Docs Guild",
      slug: "arc-docs-guild",
      description: "Pays writers for clear guides, threads and pull requests that help builders ship on Arc.",
      logoUrl: "",
    },
    rubric: {
      generalRules: "English only. Original work about building on Arc.",
      categories: [
        {
          name: "Threads and posts",
          description: "Original posts or threads that teach something about the project.",
          sourceTypes: ["x_post"],
          maxPoints: "10",
          criteria: [
            { name: "Depth", description: "Explains how or why, not just what." },
            { name: "Clarity", description: "Easy to follow for the intended audience." },
          ],
          rules: "Threads should be at least 3 posts. Announcement retweets and memes are not paid.",
          requireMerged: true,
        },
        {
          name: "Pull requests",
          description: "Code, docs or test contributions to the project's public repositories.",
          sourceTypes: ["github_pr"],
          maxPoints: "20",
          criteria: [{ name: "Impact", description: "Fixes a real problem or adds a useful capability." }],
          rules: "Only merged pull requests are paid.",
          requireMerged: true,
        },
      ],
    },
    budget: {
      ratePerPoint: "0.5",
      roundLengthDays: "7",
      startMode: "now",
      firstRoundStartsAt: "",
      autoApproveConfidence: "0.8",
      maxAutoApproveItem: "",
      minAccountAgeDays: "30",
    },
    limits: { maxPerPayout: "", maxPerRound: "", maxPerDay: "", autoApproveThreshold: "", payeeCooldownHours: "24" },
    limitsEdited: false,
    slugEdited: false,
  },
};

type Shot = {
  name: string;
  path: string;
  who: Who;
  /** Opens a dialog/drawer by its button name before the shot (viewport only). */
  click?: string;
  /** Seed the wizard draft first. */
  draft?: boolean;
  /** Anything else to do before the shot (full page). */
  act?: (page: import("@playwright/test").Page) => Promise<void>;
};
const PAGES: Shot[] = [
  { name: "landing-signed-in", path: "/", who: "both" },
  { name: "landing", path: "/", who: "anon" },
  { name: "home", path: "/app", who: "both" },
  { name: "program-overview", path: `/app/programs/${show.programId}`, who: "owner" },
  { name: "program-overview-new", path: `/app/programs/${show.setupProgramId}`, who: "owner" },
  { name: "submissions", path: `/app/programs/${show.programId}/submissions`, who: "owner" },
  {
    name: "submissions-board",
    path: `/app/programs/${show.programId}/submissions?view=board`,
    who: "owner",
  },
  {
    name: "submission-drawer",
    path: `/app/programs/${show.programId}/submissions`,
    who: "owner",
    click: "Review submission by @carol_writes",
  },
  {
    name: "submission-drawer-flagged",
    path: `/app/programs/${show.programId}/submissions`,
    who: "owner",
    click: "Review submission by @eve_tests",
  },
  { name: "rounds", path: `/app/programs/${show.programId}/rounds`, who: "owner" },
  {
    name: "round-detail",
    path: `/app/programs/${show.programId}/rounds/${show.round1}`,
    who: "owner",
  },
  { name: "treasury", path: `/app/programs/${show.programId}/treasury`, who: "owner" },
  { name: "settings", path: `/app/programs/${show.programId}/settings`, who: "owner" },
  { name: "audit-log", path: `/app/programs/${show.programId}/audit`, who: "owner" },
  { name: "wizard", path: "/app/programs/new", who: "owner" },
  { name: "wizard-rubric", path: "/app/programs/new?step=2", who: "owner", draft: true },
  { name: "wizard-limits", path: "/app/programs/new?step=3", who: "owner", draft: true },
  { name: "wizard-review", path: "/app/programs/new?step=4", who: "owner", draft: true },
  { name: "program-ready", path: `/app/programs/${show.setupProgramId}/ready`, who: "owner" },
  { name: "setup-deploy", path: `/app/programs/${show.setupProgramId}/setup`, who: "owner" },
  { name: "setup-live", path: `/app/programs/${show.programId}/setup`, who: "owner" },
  {
    name: "submissions-empty",
    path: `/app/programs/${show.setupProgramId}/submissions`,
    who: "owner",
  },
  {
    name: "contributors-empty",
    path: `/app/programs/${show.setupProgramId}/contributors`,
    who: "owner",
  },
  { name: "contributor-programs", path: "/c", who: "contributor" },
  {
    name: "contributor-journey",
    path: `/c/${show.slug}`,
    who: "contributor",
    act: async (page) => {
      await page.getByRole("button", { name: "Full journey" }).first().click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: "public-audit-verify",
    path: `/p/${show.slug}`,
    who: "anon",
    act: async (page) => {
      await page.getByRole("button", { name: / · approved · / }).first().click();
      await page.getByText("Verified", { exact: true }).waitFor({ timeout: 30_000 });
      await page.waitForTimeout(600);
    },
  },
  { name: "contributor-home", path: `/c/${show.slug}`, who: "contributor" },
  { name: "join", path: `/join/${show.slug}`, who: "anon" },
  { name: "join-signed-in", path: `/join/${show.slug}`, who: "contributor" },
  { name: "public-audit", path: `/p/${show.slug}`, who: "anon" },
  { name: "round-receipt", path: `/p/${show.slug}/rounds/${show.round1}`, who: "anon" },
  { name: "docs", path: "/docs", who: "anon" },
  { name: "not-found", path: "/this-page-does-not-exist", who: "anon" },
  // Error states: capture these with the database stopped (SHOTS_ONLY=error-owner,error-contributor).
  { name: "error-owner", path: `/app/programs/${show.programId}/rounds`, who: "owner" },
  { name: "error-contributor", path: `/c/${show.slug}`, who: "contributor" },
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
        if (p.draft)
          await ctx.addInitScript(
            (d) => localStorage.setItem("misthos:new-program-draft:v1", d),
            JSON.stringify(DRAFT),
          );
        await ctx.addCookies(await cookies(p.who));
        const page = await ctx.newPage();
        await page.goto(p.path, { waitUntil: "networkidle" });
        // Scroll through once so scroll-reveal content is shown, then back to the top.
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 600) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 60));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(900);
        if (p.click) {
          await page.getByRole("button", { name: p.click }).first().click();
          await page.getByRole("dialog").waitFor();
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(800);
        }
        if (p.act) await p.act(page);
        // A full-page capture would freeze sticky action bars mid-page; show them where they end up instead.
        if (!p.click)
          await page.addStyleTag({ content: "[data-sticky-actions]{position:static!important}" });
        const wide = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        if (wide) overflow.push(`${p.name} @${width} ${theme}`);
        const file = `${p.name}-${width}-${theme}.png`;
        await page.screenshot({ path: path.join(OUT, file), fullPage: !p.click });
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
console.log(
  overflow.length ? `horizontal overflow: ${overflow.join("; ")}` : "no horizontal overflow",
);
