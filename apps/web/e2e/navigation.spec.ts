import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { E2E } from "../playwright.config";
import {
  contributorSession,
  newPage,
  ownerSignIn,
  seedMember,
  seedProgram,
  userIdForWallet,
} from "./helpers";
import { injectWallet } from "./wallet";

/**
 * The navigation map (docs/NAVIGATION.md) as tests: where logos go, back links, the browser Back button through
 * drawers, the mobile menu and the wizard, sign-in and sign-out redirects, OAuth return paths and access pages.
 */

let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: E2E.dbUrl });
  await db.connect();
});
test.afterAll(async () => db.end());

const path = (page: Page) => new URL(page.url()).pathname + new URL(page.url()).search;

async function ownerWithProgram(
  browser: import("@playwright/test").Browser,
  viewport?: { width: number; height: number },
) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const wallet = await injectWallet(ctx, generatePrivateKey());
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);
  const ownerId = await userIdForWallet(db, wallet.address);
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const programId = await seedProgram(db, { ownerId, slug: `nav-${stamp}`, name: "Nav Program" });
  // One submission to open in the drawer.
  const x = { id: `91${stamp}`, handle: `nav_${stamp.slice(-6)}` };
  const { userId } = await contributorSession(db, x);
  const cid = await seedMember(db, { programId, userId, x, wallet: `0x${"cd".repeat(20)}` });
  await db.query(
    `insert into submissions (program_id, round_id, contributor_id, url, source_type, resource_id, status)
     select $1, r.id, $2, 'https://x.com/i/web/status/9', 'x_post', '9', 'escalated' from rounds r where r.program_id = $1`,
    [programId, cid],
  );
  return { ctx, page, errors, programId, slug: `nav-${stamp}`, x };
}

test("logos, back links, the active nav item and tab titles", async ({ browser }) => {
  const { page, errors, programId, slug } = await ownerWithProgram(browser, {
    width: 1360,
    height: 900,
  });
  // A second program: with exactly one, the app home opens it directly (by design).
  const ownerId = (
    await db.query<{ owner: string }>("select owner_user_id as owner from programs where id = $1", [
      programId,
    ])
  ).rows[0]!.owner;
  await seedProgram(db, { ownerId, slug: `${slug}-2`, name: "Nav Program Two" });
  const base = `/app/programs/${programId}`;

  // In the app, the logo goes to the app home; "Back to site" goes to the landing page.
  await page.goto(`${base}/treasury`);
  await expect(page).toHaveTitle("Treasury · Misthos");
  await expect(page.getByRole("link", { name: "Treasury" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("link", { name: "Misthos app home" }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page).toHaveTitle("Your programs · Misthos");
  await page.getByRole("link", { name: "Back to site" }).click();
  await expect(page).toHaveURL(`${E2E.baseURL}/`);

  // On public pages, the logo goes to the landing page.
  for (const p of [`/p/${slug}`, `/join/${slug}`, "/docs"]) {
    await page.goto(p);
    await page
      .getByRole("link", { name: /^Misthos( home)?$/ })
      .first()
      .click();
    await expect(page).toHaveURL(`${E2E.baseURL}/`);
  }

  // Nested pages have a visible way back.
  await page.goto(`${base}/rounds`);
  await page.getByRole("link", { name: "Round 1" }).first().click();
  await expect(page).toHaveTitle("Round · Nav Program · Misthos");
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await crumbs.getByRole("link", { name: "Rounds" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/rounds$`));
  await page.goto(base);
  await expect(page).toHaveTitle("Nav Program · Misthos");
  expect(errors).toEqual([]);
});

test("browser Back closes the drawer and the dialogs first, then leaves the page", async ({
  browser,
}) => {
  const { page, errors, programId } = await ownerWithProgram(browser, { width: 1360, height: 900 });
  const base = `/app/programs/${programId}`;
  await page.goto(base);
  await page.getByRole("link", { name: "Submissions" }).first().click();
  await expect(page).toHaveURL(new RegExp(`${base}/submissions$`));

  await page.getByRole("button", { name: /^Review submission by/ }).click();
  const drawer = page.getByRole("dialog", { name: "Review submission" });
  await expect(drawer).toBeVisible();
  await page.goBack();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${base}/submissions$`)); // still on the page

  // Closing with the X gives the history entry back: the next Back leaves the page as expected.
  await page.getByRole("button", { name: /^Review submission by/ }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${base}$`));

  // Forward returns to the submissions page, not to a half-open drawer.
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${base}/submissions$`));
  await expect(drawer).toBeHidden();
  expect(errors).toEqual([]);
});

test("mobile: the menu closes with Back, and its links navigate with a clean history", async ({
  browser,
}) => {
  const { page, errors, programId } = await ownerWithProgram(browser, { width: 390, height: 844 });
  const base = `/app/programs/${programId}`;
  await page.goto(base);

  const menu = page.getByRole("dialog", { name: "Navigation" });
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(menu).toBeVisible();
  await page.goBack();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${base}$`));

  await page.getByRole("button", { name: "Open menu" }).click();
  await menu.getByRole("link", { name: "Rounds" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/rounds$`));
  await expect(menu).toBeHidden();
  await page.goBack(); // one Back: straight to where the menu was opened
  await expect(page).toHaveURL(new RegExp(`${base}$`));
  await expect(menu).toBeHidden();

  // The mobile header logo also goes to the app home (which, with one program, opens that program).
  await expect(page.getByRole("link", { name: "Misthos app home" })).toHaveAttribute(
    "href",
    "/app",
  );
  expect(errors).toEqual([]);
});

test("wizard steps follow Back and Forward without losing what was typed", async ({ browser }) => {
  const ctx = await browser.newContext();
  await injectWallet(ctx, generatePrivateKey());
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);
  await page.goto("/app/programs/new");
  await page.getByLabel("Program name").fill("Back Button Builders");
  await page
    .getByLabel("Description")
    .fill("Pays builders for clear guides about building on Arc.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/step=2/);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/step=3/);

  await page.goBack();
  await expect(page).toHaveURL(/step=2/);
  await expect(page.getByText("How a score becomes USDC")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/step=1|\/new$/);
  await expect(page.getByLabel("Program name")).toHaveValue("Back Button Builders");
  await page.goForward();
  await page.goForward();
  await expect(page).toHaveURL(/step=3/);
  // The in-page Back button and "Save and exit" lead out of the wizard; the draft stays on the device.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/step=2/);
  await expect(page.getByRole("link", { name: "Back to site" })).toHaveCount(0); // full screen, no rail
  await page.getByRole("link", { name: "Save and exit" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/programs/new");
  await expect(page.getByLabel("Program name")).toHaveValue("Back Button Builders");
  expect(errors).toEqual([]);
});

test("guided setup: ready screen → setup → finish later, with the way back", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const key = generatePrivateKey();
  await injectWallet(ctx, key);
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);
  const ownerId = await userIdForWallet(db, privateKeyToAccount(key).address);
  const programId = await seedProgram(db, {
    ownerId,
    slug: `ready-${Date.now()}`,
    status: "draft",
  });
  const base = `/app/programs/${programId}`;
  await page.goto(`${base}/ready`);
  await expect(page.getByRole("heading", { name: "Your program is ready" })).toBeVisible();
  await expect(page).toHaveTitle(/is ready · Misthos$/);
  await page.getByRole("link", { name: "Set up the vault" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/setup$`));
  await expect(page.getByRole("heading", { name: "Deploy your vault", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Setup steps" })).toContainText(
    "Fund the vault",
  );
  // Browser Back returns to the ready screen; "Finish later" goes to the overview.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${base}/ready$`));
  await page.goForward();
  await page.getByRole("link", { name: "Finish later" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}$`));
  // The overview's setup track opens the same guided flow.
  await page.getByRole("link", { name: "Deploy the vault" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/setup$`));
  // The logo leaves the flow for the app home.
  await page.getByRole("link", { name: "Misthos app home" }).click();
  await expect(page).toHaveURL(/\/app(\/programs\/[0-9a-f-]{36})?$/);
  expect(errors).toEqual([]);
});

test("owner: a protected page signs in in place and stays there; sign-out lands on the landing page", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const wallet = await injectWallet(ctx, generatePrivateKey());
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);
  const ownerId = await userIdForWallet(db, wallet.address);
  const programId = await seedProgram(db, { ownerId, slug: `nav-in-${Date.now()}` });

  // Signed out (cookie gone): the deep link shows sign-in, then returns to that exact page.
  await ctx.clearCookies({ name: "misthos_owner" });
  await page.goto(`/app/programs/${programId}/treasury`);
  await expect(page.getByRole("heading", { name: "Sign in to Misthos" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Treasury", level: 1 })).toBeVisible();
  expect(path(page)).toBe(`/app/programs/${programId}/treasury`);

  // Sign out: the landing page says so, and the app asks to sign in again (no blank or error page).
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${E2E.baseURL}/`);
  await expect(page.getByRole("status").filter({ hasText: "You're signed out." })).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Start a program" }),
  ).toBeVisible();
  await page.goto(`/app/programs/${programId}/settings`);
  await expect(page.getByRole("heading", { name: "Sign in to Misthos" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("contributors: dashboard links, X and GitHub return paths, the owner app and the landing header", async ({
  browser,
}) => {
  const owner = await db.query<{ id: string }>(
    "insert into users (wallet_address) values ($1) returning id",
    [`0x${Date.now().toString(16).padStart(40, "e")}`],
  );
  const slug = `nav-c-${Date.now()}`;
  const programId = await seedProgram(db, { ownerId: owner.rows[0]!.id, slug });
  const ctx = await browser.newContext();
  const { page, errors } = await newPage(ctx);

  // Signed out, the dashboard link goes to the join page, whose sign-in comes back to the dashboard.
  await page.goto(`/c/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/join/${slug}\\?return=dashboard$`));
  await expect(page.getByRole("link", { name: "Sign in with X" })).toHaveAttribute(
    "href",
    `/api/auth/x/start?next=${encodeURIComponent(`/c/${slug}`)}`,
  );
  await page.goto(`/join/${slug}`);
  await expect(page.getByRole("link", { name: "Sign in with X" })).toHaveAttribute(
    "href",
    `/api/auth/x/start?next=${encodeURIComponent(`/join/${slug}`)}`,
  );

  // X: the start carries `next` through the flow; a cancelled sign-in returns to it, an outside URL never.
  const r = ctx.request;
  let res = await r.get(`/api/auth/x/start?next=${encodeURIComponent(`/join/${slug}`)}`, {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers().location!).hostname).toMatch(/(^|\.)(x|twitter)\.com$/);
  res = await r.get("/api/auth/x/callback?error=access_denied", { maxRedirects: 0 });
  expect(res.headers().location).toBe(`${E2E.baseURL}/join/${slug}?x_error=denied`);
  await r.get(`/api/auth/x/start?next=${encodeURIComponent("//evil.example/steal")}`, {
    maxRedirects: 0,
  });
  res = await r.get("/api/auth/x/callback?error=access_denied", { maxRedirects: 0 });
  expect(res.headers().location).toBe(`${E2E.baseURL}/?x_error=denied`);

  // GitHub: needs the X session; either way it returns to the contributor page.
  res = await r.get(`/api/auth/github/start?next=${encodeURIComponent(`/c/${slug}`)}`, {
    maxRedirects: 0,
  });
  expect(res.headers().location).toBe(`${E2E.baseURL}/c/${slug}?github_error=sign_in_required`);
  const x = { id: `92${Date.now()}`, handle: "nav_contrib" };
  const { userId, cookie } = await contributorSession(db, x);
  await seedMember(db, { programId, userId, x, wallet: `0x${"ef".repeat(20)}` });
  // As the X callback does: the session plus the hint the static landing page reads.
  await ctx.addCookies([
    cookie,
    {
      name: "misthos_hint",
      value: encodeURIComponent(JSON.stringify({ c: x.handle })),
      url: E2E.baseURL,
    },
  ]);
  res = await r.get(`/api/auth/github/start?next=${encodeURIComponent(`/c/${slug}`)}`, {
    maxRedirects: 0,
  });
  if (new URL(res.headers().location!).hostname === "github.com") {
    res = await r.get("/api/auth/github/callback?error=access_denied", { maxRedirects: 0 });
    expect(res.headers().location).toBe(`${E2E.baseURL}/c/${slug}?github_error=denied`);
  } else {
    // GitHub OAuth isn't configured in this environment: it still returns to the contributor page.
    expect(res.headers().location).toBe(`${E2E.baseURL}/c/${slug}?github_error=not_configured`);
  }

  // Signed in: the dashboard opens, with a way back to all joined programs.
  await page.goto(`/c/${slug}`);
  await expect(page).toHaveTitle("Your contributions · Misthos");
  await page.getByRole("link", { name: "Programs you joined" }).first().click();
  await expect(page).toHaveURL(/\/c$/);

  // The owner app explains itself to a contributor and points to their programs.
  await page.goto("/app");
  const note = page.getByRole("region", { name: "Signed in as a contributor" });
  await expect(note).toContainText("@nav_contrib");
  await note.getByRole("link", { name: "Go to the programs you joined" }).click();
  await expect(page).toHaveURL(/\/c$/);

  // The landing header offers the app instead of sign-in.
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("link", { name: "Open app" })).toHaveAttribute(
    "href",
    "/c",
  );
  expect(errors).toEqual([]);
});
