/**
 * Before/after screenshots for the UI polish pass: landing (signed out / signed in), sign-in, the owner app with
 * the wallet disconnected and on a different account (and the dialog an action opens then), contributor pages.
 * Read-only against a local build that uses the real database: sessions are minted with the local SESSION_SECRET
 * (so this never works against production), the wallet is the e2e fake wallet (random keys, nothing is sent).
 *
 *   NEXT_DIST_DIR=.next-sweep pnpm build && NEXT_DIST_DIR=.next-sweep pnpm exec next start -p 3300
 *   SHOTS_DIR=docs/screenshots/polish/before pnpm --filter @misthos/web exec tsx scripts/polish-shots.mts
 */
import { createDb } from "@misthos/db";
import nextEnv from "@next/env";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { generatePrivateKey } from "viem/accounts";
import { injectWallet } from "../e2e/wallet";

const root = path.resolve(import.meta.dirname, "../../..");
nextEnv.loadEnvConfig(root);
const BASE = process.env.SHOW_BASE ?? "http://localhost:3300";
const OUT = path.join(root, process.env.SHOTS_DIR ?? "docs/screenshots/polish/after");
mkdirSync(OUT, { recursive: true });

const { pool } = createDb(process.env.DATABASE_URL!, { max: 1 });
const one = async <T,>(sql: string) => (await pool.query(sql)).rows[0] as T;
const kency = await one<{ id: string; owner_id: string; wallet: string }>(
  `select p.id, pm.user_id owner_id, u.wallet_address wallet from programs p join program_members pm on pm.program_id = p.id and pm.role = 'owner' join users u on u.id = pm.user_id where p.slug = 'kency-arc-creators'`,
);
const member = await one<{ user_id: string; x_user_id: string; x_handle: string }>(
  `select user_id, x_user_id, x_handle from contributors where program_id = '${kency.id}' limit 1`,
);
await pool.end();

const key = new TextEncoder().encode(process.env.SESSION_SECRET!);
const jwt = (c: Record<string, unknown>) =>
  new SignJWT(c)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("misthos")
    .setExpirationTime("2h")
    .sign(key);
const owner = { misthos_owner: await jwt({ sub: kency.owner_id, kind: "owner", addr: kency.wallet }) };
const contributor = {
  misthos_contributor: await jwt({
    sub: member.user_id,
    kind: "contributor",
    xid: member.x_user_id,
    xh: member.x_handle,
  }),
};
const hint = { misthos_hint: encodeURIComponent(JSON.stringify({ o: kency.wallet })) };

async function ctx(
  browser: Browser,
  width: number,
  cookies: Record<string, string>,
  theme = "light",
  before?: (c: BrowserContext) => Promise<unknown>,
): Promise<{ c: BrowserContext; page: Page }> {
  const c = await browser.newContext({
    baseURL: BASE,
    viewport: { width, height: width < 600 ? 812 : 900 },
    deviceScaleFactor: 2,
    colorScheme: theme as "light" | "dark",
  });
  // tsx (esbuild keepNames) wraps functions in __name(); serialized init scripts need it in the page too.
  await c.addInitScript("window.__name = (f) => f;");
  await c.addInitScript(`try { localStorage.setItem("theme", ${JSON.stringify(theme)}) } catch {}`);
  await c.addCookies(
    Object.entries(cookies).map(([name, value]) => ({ name, value, url: BASE })),
  );
  await before?.(c);
  return { c, page: await c.newPage() };
}

async function shot(page: Page, name: string, full = false) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log("  ", name);
}

const browser = await chromium.launch();
const P = `/app/programs/${kency.id}`;
try {
  for (const [name, cookies, where] of [
    ["landing-signed-out", {}, "/"],
    ["landing-signed-in", hint, "/"],
    ["sign-in", {}, "/app"],
    ["contributor-home", contributor, "/c"],
    ["contributor-program", contributor, "/c/kency-arc-creators"],
    ["join-member", contributor, "/join/kency-arc-creators"],
  ] as const) {
    const { c, page } = await ctx(browser, 1440, cookies);
    await page.goto(where, { waitUntil: "networkidle" });
    await shot(page, name);
    await c.close();
  }
  {
    const { c, page } = await ctx(browser, 390, {});
    await page.goto("/", { waitUntil: "networkidle" });
    await shot(page, "mobile-landing");
    await c.close();
  }
  // Owner app, no wallet connected (browsing only).
  {
    const { c, page } = await ctx(browser, 1440, owner);
    await page.goto(P, { waitUntil: "networkidle" });
    await shot(page, "owner-overview-no-wallet");
    await c.close();
  }
  // Owner app with the wallet on another account: browsing, then an action that needs the owner wallet.
  {
    const { c, page } = await ctx(browser, 1440, owner, "light", (c) =>
      injectWallet(c, [generatePrivateKey()]),
    );
    await page.goto(`${P}/treasury`, { waitUntil: "networkidle" });
    // Connect the (other) wallet from the sidebar, as a person would.
    // Before the polish pass the rail had a "Connect wallet" button; now it's in the account menu.
    const direct = page.getByRole("button", { name: /^connect/i }).first();
    if (await direct.isVisible().catch(() => false)) await direct.click();
    else {
      await page.getByRole("button", { name: /^Account 0x.*not connected/ }).click();
      await page.getByRole("menuitem", { name: "Connect wallet" }).click();
    }
    await page
      .getByRole("dialog", { name: "Connect a wallet" })
      .getByRole("button", { name: /metamask/i })
      .click();
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape");
    await shot(page, "owner-other-account-browsing");
    // Wallet islands load when on screen: bring the vault controls into view first.
    await page.getByText(/Payouts are running normally|The vault is paused/).scrollIntoViewIfNeeded();
    const pause = page.getByRole("button", { name: /pause vault|resume payouts/i }).first();
    await pause.waitFor();
    await pause.click();
    await page.getByRole("dialog").waitFor();
    await shot(page, "owner-other-account-action");
    await c.close();
  }
  // New in this pass: the wizard's context step, Settings → context and rules, the nudge on the overview.
  if (process.env.SHOTS_FEATURES) {
    const { c, page } = await ctx(browser, 1440, owner);
    await page.goto("/app/programs/new", { waitUntil: "networkidle" });
    await page.getByLabel("Program name").fill("Arc Creators");
    await page.getByLabel("Description").fill("Pays builders for original threads and guides about Arc.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page
      .getByLabel("About this program")
      .fill(
        "Arc is Circle's stablecoin-native Layer 1: gas is paid in USDC and blocks are final in under a second. We pay for tutorials, threads that explain how something works, and pull requests.\n\nPost about: building on Arc, USDC gas, Circle wallets.\nAvoid: token price talk, airdrop farming, memes.",
      );
    await page.getByLabel("Links (optional)").fill("https://www.circle.com/blog\n@arc");
    await page.getByLabel("Posts must include (optional)").fill("@arc, #BuildOnArc");
    await shot(page, "wizard-context-step", true);
    await page.goto(`${P}/settings#context`, { waitUntil: "networkidle" });
    await shot(page, "settings-context");
    await page.goto(P, { waitUntil: "networkidle" });
    await shot(page, "overview-context-nudge");
    await c.close();
    const cc = await ctx(browser, 1440, contributor);
    await cc.page.goto("/join/kency-arc-creators", { waitUntil: "networkidle" });
    await cc.page.getByRole("heading", { name: "Rules" }).scrollIntoViewIfNeeded();
    await shot(cc.page, "join-rules");
    await cc.page.goto("/c/kency-arc-creators", { waitUntil: "networkidle" });
    await cc.page.getByRole("button", { name: "Ask for a second look" }).first().scrollIntoViewIfNeeded();
    await cc.page.getByRole("button", { name: "Ask for a second look" }).first().click();
    await shot(cc.page, "contributor-second-look");
    await cc.c.close();
  }
} finally {
  await browser.close();
}
