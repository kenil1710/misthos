import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { E2E } from "../playwright.config";
import { contributorSession, newPage, ownerSignIn, seedProgram } from "./helpers";
import { injectWallet } from "./wallet";

/** The public "Explore campaigns" page: published campaigns with an open round, on the header's network only. */

let db: pg.Client;
const RUN = Date.now().toString(36);
const slug = (s: string) => `x-${s}-${RUN}`;

test.beforeAll(async () => {
  db = new pg.Client({ connectionString: E2E.dbUrl });
  await db.connect();
  const owner = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
  const { rows } = await db.query<{ id: string }>(
    "insert into users (wallet_address) values ($1) returning id",
    [owner],
  );
  const ownerId = rows[0]!.id;
  const vault = (i: number) => `0x${String(i).padStart(40, "e")}`;
  await seedProgram(db, { ownerId, slug: slug("open"), name: `Open ${RUN}`, vault: vault(1) });
  await seedProgram(db, {
    ownerId,
    slug: slug("main"),
    name: `Mainnet ${RUN}`,
    vault: vault(2),
    chain: "arc-mainnet",
  });
  await seedProgram(db, { ownerId, slug: slug("draft"), name: `Draft ${RUN}`, status: "draft" });
  await seedProgram(db, {
    ownerId,
    slug: slug("paused"),
    name: `Paused ${RUN}`,
    status: "paused",
    vault: vault(3),
  });
  await seedProgram(db, {
    ownerId,
    slug: slug("later"),
    name: `Later ${RUN}`,
    vault: vault(4),
    roundStartsInDays: 3,
  });
  await seedProgram(db, { ownerId, slug: `qa-${RUN}`, name: `QA Program ${RUN}`, vault: vault(5) });
  const demo = await seedProgram(db, {
    ownerId,
    slug: slug("demo"),
    name: `Demo ${RUN}`,
    vault: vault(6),
  });
  await db.query("update programs set is_demo = true where id = $1", [demo]);
});
test.afterAll(async () => db.end());

const cards = (page: Page) => page.getByTestId("campaign-card");

/**
 * The list is shared-cached for 45 s, and an earlier spec may have filled it (even by prefetching a /campaigns link)
 * before this one seeded its campaigns: reload until the seeded card shows.
 */
async function reloadUntil(page: Page, card: string) {
  await expect
    .poll(
      async () => {
        const n = await cards(page).filter({ hasText: card }).count();
        if (!n) await page.reload();
        return n;
      },
      { timeout: 90_000, intervals: [3_000] },
    )
    .toBe(1);
}

test("explore lists open, published campaigns on the selected network, and nothing else", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const { page, errors } = await newPage(ctx);

  // Reached from the landing header.
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Explore", exact: true })
    .click();
  await expect(page).toHaveURL(/\/campaigns$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore campaigns");

  await reloadUntil(page, `Open ${RUN}`);
  const open = cards(page).filter({ hasText: `Open ${RUN}` });
  await expect(open).toContainText("Testnet");
  await expect(open).toContainText("Pays for");
  await expect(open).toContainText("up to");
  await expect(open).toContainText("Contributors");
  await expect(open.getByRole("link", { name: `Join Open ${RUN}` })).toHaveAttribute(
    "href",
    `/join/${slug("open")}`,
  );
  for (const hidden of ["Mainnet", "Draft", "Paused", "Later", "QA Program", "Demo"])
    await expect(cards(page).filter({ hasText: `${hidden} ${RUN}` })).toHaveCount(0);
  // Signed out: the public layout, no app sidebar.
  await expect(page.locator("aside")).toHaveCount(0);
  // No owner wallet on the page (the seeded vault addresses aren't shown either: balance only).
  await expect(page.locator("main")).not.toContainText(/0x[0-9a-f]{40}/i);

  // Mainnet: only the mainnet campaign.
  await page.getByTestId("network-switch").click();
  await page.getByRole("menuitemradio", { name: /Arc Mainnet/ }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.network))
    .toBe("arc-mainnet");
  await reloadUntil(page, `Mainnet ${RUN}`);
  await expect(cards(page).filter({ hasText: `Open ${RUN}` })).toHaveCount(0);

  // Join goes to the join page.
  await cards(page)
    .filter({ hasText: `Mainnet ${RUN}` })
    .getByRole("link", { name: /^Join/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/join/${slug("main")}$`));
  expect(errors).toEqual([]);
});

test("explore: the hero and footer link to it", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("main").getByRole("link", { name: "Explore campaigns" }),
  ).toHaveAttribute("href", "/campaigns");
  await expect(
    page
      .getByRole("navigation", { name: "Footer" })
      .getByRole("link", { name: "Explore campaigns" }),
  ).toHaveAttribute("href", "/campaigns");
});

test("explore: an empty network says so", async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addCookies([
    { name: "misthos_network", value: "arc-mainnet", url: E2E.baseURL, sameSite: "Lax" },
  ]);
  const page = await ctx.newPage();
  // Close every mainnet campaign's round, so Arc Mainnet has nothing open (the list is cached briefly; a fresh
  // query key would be needed to see it at once, so only assert when the page already reflects it).
  await db.query(
    "update programs set status = 'paused' where chain = 'arc-mainnet' and status = 'active' and slug <> $1",
    [slug("main")],
  );
  await db.query(
    "update rounds set status = 'closed' where program_id = (select id from programs where slug = $1)",
    [slug("main")],
  );
  await expect
    .poll(
      async () => {
        await page.goto("/campaigns");
        return page.getByTestId("explore-empty").count();
      },
      { timeout: 90_000, intervals: [5_000] },
    )
    .toBe(1);
  await expect(page.getByTestId("explore-empty")).toContainText(
    "No open campaigns on Arc Mainnet yet",
  );
});

test("explore from the app: the welcome page offers it, the sidebar links to it and stays on /campaigns", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await injectWallet(ctx, generatePrivateKey());
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);

  // A new owner: "Create your first program" stays primary, with a way to earn instead.
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Welcome to Misthos" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Create your first program" })).toBeVisible();
  await expect(main.getByText("Want to earn instead?")).toBeVisible();
  await expect(main.getByRole("link", { name: "Explore campaigns" })).toHaveAttribute(
    "href",
    "/campaigns",
  );

  // The sidebar's Workspace link, active on /campaigns, which keeps the app frame.
  const rail = page.locator("aside");
  const link = rail.getByRole("link", { name: "Explore campaigns" });
  await expect(link).not.toHaveAttribute("aria-current", "page");
  await link.click();
  await expect(page).toHaveURL(/\/campaigns$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore campaigns");
  await expect(rail.getByRole("link", { name: "Explore campaigns" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(cards(page).filter({ hasText: `Open ${RUN}` })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("explore: a contributor with no programs is pointed to it", async ({ browser }) => {
  const ctx = await browser.newContext();
  const { cookie } = await contributorSession(db, { id: `explore-${RUN}`, handle: `ex_${RUN}` });
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  await page.goto("/c");
  await expect(page.getByText("No programs yet")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Explore campaigns" }).click();
  await expect(page).toHaveURL(/\/campaigns$/);
  // Signed in with X only: the contributor header, not the owner sidebar.
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Programs you joined" })).toBeVisible();
});
