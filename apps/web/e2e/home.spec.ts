import { expect, test } from "@playwright/test";
import pg from "pg";
import { generatePrivateKey } from "viem/accounts";
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

/** Signed-in homes, the landing header, previews and 404s, focus behaviour and the main error states. */

let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: E2E.dbUrl });
  await db.connect();
});
test.afterAll(async () => db.end());

test("owner with several programs: cards, what needs them, and what they joined", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const wallet = await injectWallet(ctx, generatePrivateKey());
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);
  const ownerId = await userIdForWallet(db, wallet.address);
  const stamp = Date.now();
  const a = await seedProgram(db, { ownerId, slug: `home-a-${stamp}`, name: "Alpha Writers" });
  await seedProgram(db, { ownerId, slug: `home-b-${stamp}`, name: "Beta Builders" });

  // An escalated submission in Alpha: it shows under "Needs you" and on Alpha's card.
  const x = { id: `81${stamp}`, handle: "card_tester" };
  const { userId, cookie } = await contributorSession(db, x);
  const cid = await seedMember(db, { programId: a, userId, x, wallet: `0x${"ab".repeat(20)}` });
  await db.query(
    `insert into submissions (program_id, round_id, contributor_id, url, source_type, resource_id, status)
     select $1, r.id, $2, 'https://x.com/i/web/status/1', 'x_post', '1', 'escalated' from rounds r where r.program_id = $1`,
    [a, cid],
  );
  await ctx.addCookies([cookie]); // the owner also joined a program with X

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Your programs" })).toBeVisible();
  const needs = page.getByRole("region", { name: "Needs you" });
  await expect(needs).toContainText("Alpha Writers: 1 submission waiting for your review");
  const cards = page.getByRole("region", { name: "Programs", exact: true });
  await expect(cards.getByRole("article").filter({ hasText: "Alpha Writers" })).toContainText(
    "Needs you · 1",
  );
  // No vault yet: the card leads with the next setup step rather than the round.
  await expect(cards.getByRole("article").filter({ hasText: "Beta Builders" })).toContainText(
    "Next: deploy the vault",
  );
  await expect(page.getByRole("heading", { name: "Programs you joined" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Programs you joined" })).toBeVisible(); // sidebar

  // The landing page knows who's signed in (static page, hint cookie).
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Open app" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Start a program" })).toHaveCount(0);
  await expect(header).toContainText(wallet.address.slice(0, 6).toLowerCase());
  expect(errors).toEqual([]);
});

test("contributor home lists joined programs with round, waiting and earned", async ({
  browser,
}) => {
  const owner = await db.query<{ id: string }>(
    "insert into users (wallet_address) values ($1) returning id",
    [`0x${Date.now().toString(16).padStart(40, "d")}`],
  );
  const stamp = Date.now();
  const programId = await seedProgram(db, {
    ownerId: owner.rows[0]!.id,
    slug: `joined-${stamp}`,
    name: "Gamma Guild",
  });
  const x = { id: `82${stamp}`, handle: "joiner" };
  const { userId, cookie } = await contributorSession(db, x);
  await seedMember(db, { programId, userId, x, wallet: `0x${"cd".repeat(20)}` });
  const ctx = await browser.newContext();
  await ctx.addCookies([cookie]);
  const { page, errors } = await newPage(ctx);
  await page.goto("/c");
  await expect(page.getByRole("heading", { name: "Programs you joined" })).toBeVisible();
  const card = page.getByRole("article").filter({ hasText: "Gamma Guild" });
  await expect(card).toContainText("Round 1 is open");
  await expect(card).toContainText("Earned");
  await card.getByRole("link", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/joined-${stamp}$`));
  // Next steps are tailored: an X-only program says to post from the handle, nothing about GitHub.
  await expect(page.getByText("Post on X from @joiner")).toBeVisible();
  await expect(page.getByText(/gitHub/)).toHaveCount(0);
  // The rules disclosure uses our chevron and toggles.
  const toggle = page.getByRole("button", { name: "What this program pays for" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test("drafts: the owner sees a preview, everyone else a helpful 404", async ({ browser }) => {
  const ctx = await browser.newContext();
  const wallet = await injectWallet(ctx, generatePrivateKey());
  const { page } = await newPage(ctx);
  await ownerSignIn(page);
  const ownerId = await userIdForWallet(db, wallet.address);
  const slug = `draft-${Date.now()}`;
  await seedProgram(db, { ownerId, slug, status: "draft" });
  await page.goto(`/join/${slug}`);
  await expect(page.getByText(/Preview: this join page isn't public yet/)).toBeVisible();
  await page.goto(`/p/${slug}`);
  await expect(page.getByText(/Preview: this audit page isn't public yet/)).toBeVisible();

  const anon = await browser.newPage();
  const res = await anon.goto(`/join/${slug}`);
  expect(res?.status()).toBe(404);
  await expect(anon.getByRole("heading", { name: "Page not found" })).toBeVisible();
  for (const name of ["Your programs", "Programs you joined", "Home", "Docs"])
    await expect(anon.getByRole("link", { name, exact: true })).toBeVisible();
});

test("a published program with no payouts has a working audit page", async ({ page }) => {
  const owner = await db.query<{ id: string }>(
    "insert into users (wallet_address) values ($1) returning id",
    [`0x${Date.now().toString(16).padStart(40, "e")}`],
  );
  const slug = `quiet-${Date.now()}`;
  await seedProgram(db, { ownerId: owner.rows[0]!.id, slug });
  const res = await page.goto(`/p/${slug}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Nothing to audit yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verify a decision" })).toBeVisible();
});

test("non-members get a 404 for someone else's program; expired sessions are explained", async ({
  browser,
}) => {
  const other = await db.query<{ id: string }>(
    "insert into users (wallet_address) values ($1) returning id",
    [`0x${Date.now().toString(16).padStart(40, "f")}`],
  );
  const theirs = await seedProgram(db, { ownerId: other.rows[0]!.id, slug: `theirs-${Date.now()}` });
  const ctx = await browser.newContext();
  await injectWallet(ctx, generatePrivateKey());
  const { page } = await newPage(ctx);
  await ownerSignIn(page);
  const res = await page.goto(`/app/programs/${theirs}`);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  // Contributor whose session expires mid-visit: submitting explains it and keeps the link.
  const slug = `expiry-${Date.now()}`;
  const programId = await seedProgram(db, { ownerId: other.rows[0]!.id, slug });
  const x = { id: `83${Date.now()}`, handle: "expiring" };
  const { userId, cookie } = await contributorSession(db, x);
  await seedMember(db, { programId, userId, x, wallet: `0x${"ef".repeat(20)}` });
  const c = await browser.newContext();
  await c.addCookies([cookie]);
  const cp = await c.newPage();
  await cp.goto(`/c/${slug}`);
  await c.clearCookies();
  await cp.getByLabel("Submit your work").fill("https://x.com/expiring/status/123456789");
  await cp.getByRole("button", { name: "Submit" }).click();
  await expect(cp.getByText("Your session expired. Sign in with X again")).toBeVisible();
  await expect(cp.getByLabel("Submit your work")).toHaveValue(
    "https://x.com/expiring/status/123456789",
  );
});

test("submitting is instant (optimistic) and a double click creates one submission", async ({
  browser,
}) => {
  const owner = await db.query<{ id: string }>(
    "insert into users (wallet_address) values ($1) returning id",
    [`0x${Date.now().toString(16).padStart(40, "1")}`],
  );
  const slug = `submit-${Date.now()}`;
  const programId = await seedProgram(db, { ownerId: owner.rows[0]!.id, slug });
  const x = { id: `84${Date.now()}`, handle: "fastsubmit" };
  const { userId, cookie } = await contributorSession(db, x);
  const cid = await seedMember(db, { programId, userId, x, wallet: `0x${"12".repeat(20)}` });
  const ctx = await browser.newContext();
  await ctx.addCookies([cookie]);
  const { page, errors } = await newPage(ctx);
  await page.goto(`/c/${slug}`);
  await page.getByLabel("Submit your work").fill("https://x.com/fastsubmit/status/987654321");
  const submit = page.getByRole("button", { name: "Submit" });
  await submit.dblclick();
  await expect(page.getByText(/status\/987654321/)).toBeVisible();
  await expect(page.getByText("Queued").first()).toBeVisible();
  await page.waitForTimeout(1000);
  const { rows } = await db.query("select id from submissions where contributor_id = $1", [cid]);
  expect(rows).toHaveLength(1);
  // Invalid input is caught before anything is sent.
  await page.getByLabel("Submit your work").fill("not a link");
  await expect(page.getByRole("button", { name: "Submit" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("focus rings only for keyboard: clicks on the logo, nav and switcher leave none", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const wallet = await injectWallet(ctx, generatePrivateKey());
  const { page } = await newPage(ctx);
  await ownerSignIn(page);
  const ownerId = await userIdForWallet(db, wallet.address);
  const stamp = Date.now();
  const a = await seedProgram(db, { ownerId, slug: `focus-a-${stamp}`, name: "Focus A" });
  await seedProgram(db, { ownerId, slug: `focus-b-${stamp}`, name: "Focus B" });
  const noRing = () =>
    page.evaluate(() => document.querySelector(":focus-visible") === null);

  await page.goto(`/app/programs/${a}`);
  await page.getByRole("link", { name: "Treasury" }).click();
  await expect(page).toHaveURL(/treasury/);
  expect(await noRing()).toBe(true);

  await page.getByRole("link", { name: "Misthos home" }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  expect(await noRing()).toBe(true);

  await page.getByRole("button", { name: /switch program/i }).click();
  await page.getByRole("menuitem", { name: "Focus B" }).click();
  await expect(page).toHaveURL(/\/app\/programs\//);
  expect(await noRing()).toBe(true);

  // Keyboard users still get a visible ring.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.querySelector(":focus-visible") !== null)).toBe(true);
});
