/**
 * Capture every main screen in light and dark (1440px) plus key screens at 375px, from the showcase stack
 * (throwaway DB seeded by apps/worker seed:showcase, app on :3100). Output: docs/screenshots/.
 *
 *   pnpm --filter @misthos/web exec tsx scripts/screenshots.mts
 */
import nextEnv from "@next/env";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "../../..");
nextEnv.loadEnvConfig(root);
const BASE = "http://localhost:3100";
/** SHOTS_DIR overrides the output folder (e.g. docs/screenshots/redesign/after). */
const OUT = path.join(root, process.env.SHOTS_DIR ?? "docs/screenshots");
const show = JSON.parse(readFileSync(path.join(root, "apps/worker/scripts/.showcase.json"), "utf8")) as {
  programId: string;
  slug: string;
  ownerUserId: string;
  owner: string;
  contributor: { id: string; userId: string; xid: string };
  escalatedSubmission: string;
  round1: string;
  setupProgramId?: string;
};

const key = new TextEncoder().encode(process.env.SESSION_SECRET!);
const token = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setIssuer("misthos").setExpirationTime("2h").sign(key);

async function context(browser: Awaited<ReturnType<typeof chromium.launch>>, theme: "light" | "dark", width: number, who: "anon" | "owner" | "contributor") {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  // Keep the Next.js dev overlay out of the screenshots.
  await ctx.addInitScript(() => {
    const s = document.createElement("style");
    s.textContent = "nextjs-portal{display:none!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(s));
  });
  if (who === "owner") {
    await ctx.addCookies([{ name: "misthos_owner", value: await token({ sub: show.ownerUserId, kind: "owner", addr: show.owner.toLowerCase() }), url: BASE }]);
  }
  if (who === "contributor") {
    await ctx.addCookies([{ name: "misthos_contributor", value: await token({ sub: show.contributor.userId, kind: "contributor", xid: show.contributor.xid, xh: "alice_builds" }), url: BASE }]);
  }
  return ctx;
}

const LANDING = path.join(root, "apps/web/src/assets/landing");
const DOCS = path.join(root, "apps/web/public/screens");

async function shot(ctx: BrowserContext, name: string, url: string, prepare?: (p: Page) => Promise<void>) {
  const page = await ctx.newPage();
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  if (prepare) await prepare(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  await page.close();
  console.log(`  ${name}.png`);
}

/** A cropped capture for the landing page or docs: one element, or the first viewport. */
async function crop(ctx: BrowserContext, file: string, url: string, opts: { selector?: string; prepare?: (p: Page) => Promise<void> } = {}) {
  const page = await ctx.newPage();
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  if (opts.prepare) await opts.prepare(page);
  await page.waitForTimeout(400);
  if (opts.selector) await page.locator(opts.selector).first().screenshot({ path: file });
  else await page.screenshot({ path: file });
  await page.close();
  console.log(`  ${path.relative(root, file)}`);
}

/** Scroll through the page so scroll-reveal sections are shown before a full-page capture. */
async function revealAll(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
}

async function main() {
  const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54329/postgres?sslmode=disable" });
  await db.connect();
  const { rows } = await db.query<{ hash: string }>(
    `select d.decision_hash as hash from decisions d join submissions s on s.id = d.submission_id join contributors c on c.id = s.contributor_id
     where c.x_handle = 'alice_builds' and s.status = 'paid' order by d.created_at limit 1`,
  );
  const verifyHash = rows[0]!.hash;
  await db.end();

  const p = `/app/programs/${show.programId}`;
  const browser = await chromium.launch();
  for (const theme of ["light", "dark"] as const) {
    console.log(theme);
    const anon = await context(browser, theme, 1440, "anon");
    await shot(anon, `public-audit-${theme}`, `/p/${show.slug}`);
    await shot(anon, `public-verify-${theme}`, `/p/${show.slug}#verify?d=${verifyHash}`, async (pg) => {
      await pg.getByText(/^Verified:/).waitFor({ timeout: 30_000 });
      await pg.locator("#verify").scrollIntoViewIfNeeded();
    });
    await shot(anon, `public-round-receipt-${theme}`, `/p/${show.slug}/rounds/${show.round1}`);
    await shot(anon, `join-${theme}`, `/join/${show.slug}`);
    await shot(anon, `landing-${theme}`, "/", revealAll);
    await shot(anon, `docs-${theme}`, "/docs");
    await shot(anon, `docs-agent-${theme}`, "/docs/how-the-agent-decides");
    await crop(anon, path.join(LANDING, `verify-${theme}.png`), `/p/${show.slug}#verify?d=${verifyHash}`, {
      selector: '#verify [aria-live="polite"]',
      prepare: async (pg) => {
        await pg.getByText(/^Verified:/).waitFor({ timeout: 30_000 });
        // The panel stretches to the height of the record editor beside it; crop to its content.
        await pg.locator('#verify [aria-live="polite"]').evaluate((el) => {
          (el as HTMLElement).style.alignSelf = "start";
          (el as HTMLElement).style.height = "auto";
        });
      },
    });
    if (theme === "light") await crop(anon, path.join(DOCS, "join.png"), `/join/${show.slug}`);
    await anon.close();

    const owner = await context(browser, theme, 1440, "owner");
    await shot(owner, `app-overview-${theme}`, "/app");
    await shot(owner, `program-overview-${theme}`, p);
    await shot(owner, `submissions-${theme}`, `${p}/submissions`);
    await shot(owner, `new-program-${theme}`, "/app/programs/new");
    await crop(owner, path.join(LANDING, `hero-${theme}.png`), `${p}/submissions`, { selector: "main" });
    if (theme === "light") {
      await crop(owner, path.join(DOCS, "new-program.png"), "/app/programs/new");
      await crop(owner, path.join(DOCS, "settings.png"), `${p}/settings`);
      await crop(owner, path.join(DOCS, "round-detail.png"), `${p}/rounds/${show.round1}`);
      await crop(owner, path.join(DOCS, "review-drawer.png"), `${p}/submissions?status=escalated`, {
        prepare: async (pg) => {
          await pg.getByRole("button", { name: /Review submission by @eve_tests/ }).click();
          await pg.getByRole("dialog").getByText("Your decision").waitFor();
        },
      });
    }
    await shot(owner, `review-drawer-${theme}`, `${p}/submissions?status=escalated`, async (pg) => {
      await pg.getByRole("button", { name: /Review submission by @eve_tests/ }).click();
      await pg.getByRole("dialog").getByText("Your decision").waitFor();
    });
    await shot(owner, `contributors-${theme}`, `${p}/contributors`);
    await shot(owner, `contributor-detail-${theme}`, `${p}/contributors/${show.contributor.id}`);
    await shot(owner, `rounds-${theme}`, `${p}/rounds`);
    await shot(owner, `round-detail-${theme}`, `${p}/rounds/${show.round1}`);
    await shot(owner, `treasury-${theme}`, `${p}/treasury`);
    await shot(owner, `settings-${theme}`, `${p}/settings`);
    await shot(owner, `audit-log-${theme}`, `${p}/audit`);
    await shot(owner, `metrics-${theme}`, "/app/admin/metrics");
    if (show.setupProgramId) await shot(owner, `setup-checklist-${theme}`, `/app/programs/${show.setupProgramId}`);
    await shot(owner, `close-round-confirm-${theme}`, `${p}/rounds`, async (pg) => {
      await pg.getByRole("button", { name: "Close round now" }).click();
      await pg.getByRole("dialog").waitFor();
    });
    await owner.close();
    const signedOut = await context(browser, theme, 1440, "anon");
    await shot(signedOut, `sign-in-${theme}`, "/app");
    await signedOut.close();

    const contributor = await context(browser, theme, 1440, "contributor");
    await shot(contributor, `contributor-home-${theme}`, `/c/${show.slug}`);
    if (theme === "light") await crop(contributor, path.join(DOCS, "contributor-home.png"), `/c/${show.slug}`);
    await contributor.close();
  }

  console.log("mobile (375px)");
  const mAnon = await context(browser, "light", 375, "anon");
  await shot(mAnon, "mobile-public-audit", `/p/${show.slug}`);
  await shot(mAnon, "mobile-landing-light", "/", revealAll);
  await mAnon.close();
  const mAnonDark = await context(browser, "dark", 375, "anon");
  await shot(mAnonDark, "mobile-landing-dark", "/", revealAll);
  await shot(mAnonDark, "mobile-docs-dark", "/docs");
  await mAnonDark.close();
  const mOwner = await context(browser, "light", 375, "owner");
  await shot(mOwner, "mobile-app-overview", "/app");
  await shot(mOwner, "mobile-program-overview", `/app/programs/${show.programId}`);
  await shot(mOwner, "mobile-menu", `/app/programs/${show.programId}`, async (pg) => {
    await pg.getByRole("button", { name: "Open menu" }).click();
    await pg.getByRole("dialog").waitFor();
  });
  await mOwner.close();
  const mContributor = await context(browser, "dark", 375, "contributor");
  await shot(mContributor, "mobile-contributor-home-dark", `/c/${show.slug}`);
  await shot(mContributor, "mobile-join-dark", `/join/${show.slug}`);
  await mContributor.close();
  await browser.close();
}

main().catch((e) => {
  console.error("screenshots failed:", (e as Error).message);
  process.exit(1);
});
