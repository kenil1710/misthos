/**
 * Owner-flow screenshots for the before/after of the owner-feedback fixes, from the showcase stack (app on :3100,
 * seeded DB). Writes to SHOTS_DIR (default docs/screenshots/owner-fixes/after). A testnet wallet is injected for
 * screens that show wallet state.
 *
 *   SHOTS_DIR=docs/screenshots/owner-fixes/before pnpm --filter @misthos/web exec tsx scripts/ux-shots.mts
 */
import nextEnv from "@next/env";
import { chromium, type Browser, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import type { Hex } from "viem";
import { installWallet } from "../e2e/qa/wallet";

const root = path.resolve(import.meta.dirname, "../../..");
nextEnv.loadEnvConfig(root);
const BASE = process.env.SHOW_BASE ?? "http://localhost:3100";
const OUT = path.join(root, process.env.SHOTS_DIR ?? "docs/screenshots/owner-fixes/after");
mkdirSync(OUT, { recursive: true });
const show = JSON.parse(
  readFileSync(path.join(root, "apps/worker/scripts/.showcase.json"), "utf8"),
) as {
  programId: string;
  setupProgramId: string;
  slug: string;
  ownerUserId: string;
  owner: string;
};
const key = new TextEncoder().encode(process.env.SESSION_SECRET!);
const token = (c: Record<string, unknown>) =>
  new SignJWT(c)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("misthos")
    .setExpirationTime("2h")
    .sign(key);
const notes: Record<string, unknown> = {};

async function ctx(
  browser: Browser,
  width: number,
  who: { sub: string; addr: string } | null,
  wallet = false,
) {
  const c = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    baseURL: BASE,
  });
  await c.addInitScript(() => localStorage.setItem("theme", "light"));
  if (who)
    await c.addCookies([
      {
        name: "misthos_owner",
        value: await token({ sub: who.sub, kind: "owner", addr: who.addr.toLowerCase() }),
        url: BASE,
      },
    ]);
  const page = await c.newPage();
  if (wallet)
    await installWallet(page, process.env.DEPLOYER_PRIVATE_KEY as Hex, { authorized: true });
  return { c, page };
}
async function shot(page: Page, name: string, full = true) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log("  ", name);
}

async function main() {
  const db = new pg.Client({
    connectionString: process.env.SHOW_DB ?? "postgresql://postgres:postgres@127.0.0.1:54329/postgres?sslmode=disable",
  });
  await db.connect();
  const { rows } = await db.query<{ id: string }>(
    `insert into users (wallet_address) values ('0x00000000000000000000000000000000000000f1')
     on conflict (wallet_address) do update set wallet_address = excluded.wallet_address returning id`,
  );
  const fresh = { sub: rows[0]!.id, addr: "0x00000000000000000000000000000000000000f1" };
  const owner = { sub: show.ownerUserId, addr: show.owner };
  // The setup program is seeded without rounds; give it Round 1 starting in 5 days so the "scheduled" state shows.
  await db.query(
    `insert into rounds (program_id, number, starts_at, ends_at)
     select $1, 1, now() + interval '5 days', now() + interval '12 days'
     where not exists (select 1 from rounds where program_id = $1)`,
    [show.setupProgramId],
  );
  const browser = await chromium.launch();

  for (const width of [1440, 375]) {
    const tag = width === 375 ? "mobile-" : "";
    // Welcome (no programs)
    {
      const { c, page } = await ctx(browser, width, fresh);
      await page.goto("/app", { waitUntil: "networkidle" });
      await shot(page, `${tag}welcome`);
      // Wizard: each step, then Back to Basics
      await page.goto("/app/programs/new", { waitUntil: "networkidle" });
      await shot(page, `${tag}wizard-1-basics`);
      if (width === 1440) {
        await page.getByLabel("Program name").fill("Kency Arc Creators");
        await page
          .getByLabel("Description")
          .fill("Pays creators for original threads about building on Arc.");
        await page.getByRole("button", { name: "Continue" }).click();
        await shot(page, `wizard-2-rubric`);
        await page.getByRole("button", { name: "Continue" }).click();
        await shot(page, `wizard-3-budget`);
        await page.getByRole("button", { name: "Back" }).click();
        await page.getByRole("button", { name: "Back" }).click();
        notes.backKeepsName = await page.getByLabel("Program name").inputValue();
        await shot(page, `wizard-back-to-basics`);
        await page.reload({ waitUntil: "networkidle" });
        notes.reloadKeepsName = await page
          .getByLabel("Program name")
          .inputValue()
          .catch(() => "");
      }
      await c.close();
    }
    // Owner with programs, wallet connected
    {
      const { c, page } = await ctx(browser, width, owner, true);
      await page.goto("/app", { waitUntil: "networkidle" });
      if (width === 1440) {
        await page
          .getByRole("button", { name: /switch program/i })
          .click()
          .catch(() => {});
        await shot(page, `switcher-open`, false);
        await page.keyboard.press("Escape");
        await page.goto(`/app/programs/${show.programId}`, { waitUntil: "networkidle" });
        await page.getByRole("link", { name: "Settings" }).click();
        await page.waitForURL(/settings/);
        notes.navFocusVisibleAfterClick = await page.evaluate(
          () => document.activeElement?.matches(":focus-visible") ?? false,
        );
        await shot(page, `nav-after-click`, false);
      }
      await page.goto(`/app/programs/${show.programId}/settings`, { waitUntil: "networkidle" });
      await shot(page, `${tag}settings`);
      await page.goto(`/app/programs/${show.programId}/treasury`, { waitUntil: "networkidle" });
      await shot(page, `${tag}treasury`);
      await page.goto(`/app/programs/${show.programId}/audit`, { waitUntil: "networkidle" });
      await shot(page, `${tag}audit-log`);
      await page.goto(`/app/programs/${show.setupProgramId}/submissions`, {
        waitUntil: "networkidle",
      });
      await shot(page, `${tag}submissions-empty`);
      await page.goto(`/app/programs/${show.setupProgramId}/rounds`, { waitUntil: "networkidle" });
      await shot(page, `${tag}rounds-scheduled`);
      await page.goto(`/app/programs/${show.setupProgramId}`, { waitUntil: "networkidle" });
      await shot(page, `${tag}program-overview-draft`);
      await page.goto(`/app/programs/${show.programId}`, { waitUntil: "networkidle" });
      await shot(page, `${tag}program-overview`);
      await c.close();
    }
  }
  // Connect wallet modal, signed out, with several wallets installed in the browser
  {
    const { c, page } = await ctx(browser, 1440, null);
    await page.goto("/app", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /connect wallet/i }).click();
    await page.waitForTimeout(800);
    await shot(page, "connect-modal", false);
    await c.close();
  }
  writeFileSync(path.join(OUT, "notes.json"), JSON.stringify(notes, null, 2));
  console.log(notes);
  await browser.close();
  await db.end();
}
main().catch((e) => {
  console.error("ux-shots failed:", (e as Error).message);
  process.exit(1);
});
