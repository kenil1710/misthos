import { expect, test, type Page } from "@playwright/test";
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

/**
 * Arc Testnet / Arc Mainnet. The main server (:3100) has no mainnet agent, so Mainnet is "Coming soon" in the wizard;
 * the second server (:3101, same build) has one. Nothing touches a chain: the injected wallet fakes it.
 */

let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: E2E.dbUrl });
  await db.connect();
});
test.afterAll(async () => db.end());

const networkOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.network);
/** The header switch (off a campaign's pages). */
const headerSwitch = (page: Page) =>
  page.getByTestId("network-switch").filter({ visible: true }).first();

async function pickNetwork(page: Page, name: "Arc Testnet" | "Arc Mainnet") {
  await headerSwitch(page).click();
  await page.getByRole("menuitemradio", { name: new RegExp(name) }).click();
  await expect
    .poll(() => networkOf(page))
    .toBe(name === "Arc Mainnet" ? "arc-mainnet" : "arc-testnet");
}

test("network switch: Testnet by default, remembered per visitor (cookie, else localStorage), the landing follows it", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const { page, errors } = await newPage(ctx);
  await page.goto("/");
  expect(await networkOf(page)).toBe("arc-testnet");
  await expect(headerSwitch(page)).toHaveAccessibleName(/Network: Testnet/);
  const heroLine = page.locator("main p.net-testnet");
  await expect(heroLine).toHaveText("Live on Arc testnet with test USDC.");
  await expect(heroLine).toBeVisible();

  await pickNetwork(page, "Arc Mainnet");
  await expect(headerSwitch(page)).toHaveAccessibleName(/Network: Mainnet/);
  await expect(heroLine).toBeHidden();
  await expect(page.locator("main p.net-mainnet")).toBeVisible();
  await expect(page.locator("main p.net-mainnet")).toContainText("Arc Mainnet");
  // The landing's example decisions are testnet records: on Mainnet each example section says so (one label per
  // section that's there; a fresh e2e database may have none).
  const exampleLabels = page.getByText("Example from Arc Testnet", { exact: true });
  const exampleSections =
    (await page.getByRole("link", { name: "Verify a decision yourself" }).count()) +
    (await page.getByRole("heading", { name: /Every decision comes with its/ }).count());
  expect(await exampleLabels.count()).toBe(exampleSections);
  for (const label of await exampleLabels.all()) await expect(label).toBeVisible();
  expect((await ctx.cookies()).find((c) => c.name === "misthos_network")?.value).toBe(
    "arc-mainnet",
  );

  // Remembered across reloads, before paint.
  await page.reload();
  expect(await networkOf(page)).toBe("arc-mainnet");
  await expect(headerSwitch(page)).toContainText("Mainnet");

  // Cookie gone, localStorage still has it: the choice survives and the cookie comes back.
  await ctx.clearCookies({ name: "misthos_network" });
  await page.reload();
  expect(await networkOf(page)).toBe("arc-mainnet");
  expect((await ctx.cookies()).find((c) => c.name === "misthos_network")?.value).toBe(
    "arc-mainnet",
  );

  // Docs show it too; back to Testnet.
  await page.goto("/docs");
  await expect(headerSwitch(page)).toContainText("Mainnet");
  await pickNetwork(page, "Arc Testnet");
  await page.goto("/");
  await expect(heroLine).toBeVisible();
  for (const label of await exampleLabels.all()) await expect(label).toBeHidden();
  expect(errors).toEqual([]);
});

test("security headers: no framing, nosniff, referrer and permissions policies on pages and APIs", async ({
  request,
}) => {
  for (const path of ["/", "/docs", "/app", "/api/health"]) {
    const h = (await request.get(path)).headers();
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["content-security-policy"], path).toBe("frame-ancestors 'none'");
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"], path).toContain("camera=()");
  }
});

test("wizard: Arc Mainnet is 'Coming soon' (disabled) while this deployment has no mainnet agent", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await injectWallet(ctx, generatePrivateKey());
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);
  await page.goto("/app/programs/new");
  await expect(page.getByRole("radio", { name: /Arc Testnet/ })).toBeChecked();
  const main = page.getByRole("radio", { name: /Arc Mainnet/ });
  await expect(main).toBeDisabled();
  await expect(page.locator("label").filter({ has: main })).toContainText("Coming soon");
  expect(errors).toEqual([]);
});

test("campaign pages show the campaign's network: join, public audit and the contributor's page", async ({
  browser,
}) => {
  const stamp = Date.now();
  const [{ id: ownerId }] = (
    await db.query<{ id: string }>("insert into users (wallet_address) values ($1) returning id", [
      `0x${String(stamp).padStart(40, "7")}`,
    ])
  ).rows;
  const main = await seedProgram(db, {
    ownerId: ownerId!,
    slug: `net-main-${stamp}`,
    name: "Mainnet Makers",
    chain: "arc-mainnet",
  });
  await seedProgram(db, {
    ownerId: ownerId!,
    slug: `net-test-${stamp}`,
    name: "Testnet Tinkerers",
  });

  const ctx = await browser.newContext();
  const { page, errors } = await newPage(ctx);
  // Even with the visitor on Testnet, a mainnet campaign's pages say Mainnet (a campaign never changes network).
  await page.goto(`/join/net-main-${stamp}`);
  await expect(page.getByTestId("join-network")).toHaveText("Paid in real USDC on Arc Mainnet");
  await expect(page.getByTestId("network-badge")).toHaveText(/Mainnet/);
  await expect(page.getByTestId("network-switch")).toHaveCount(0);
  await page.goto(`/join/net-test-${stamp}`);
  await expect(page.getByTestId("join-network")).toHaveText("Paid in test USDC on Arc Testnet");
  await expect(page.getByTestId("network-badge")).toHaveText(/Testnet/);
  await page.goto(`/p/net-main-${stamp}`);
  await expect(page.getByTestId("network-badge")).toHaveText(/Mainnet/);
  await expect(page.getByRole("main")).toContainText("Arc Mainnet · real USDC");

  // The contributor's page for the mainnet campaign.
  const x = { id: `92${stamp}`, handle: "net_tester" };
  const { userId, cookie } = await contributorSession(db, x);
  await seedMember(db, { programId: main, userId, x, wallet: `0x${"cd".repeat(20)}` });
  await ctx.addCookies([cookie]);
  await page.goto(`/c/net-main-${stamp}`);
  await expect(page.getByRole("main")).toContainText("Arc Mainnet · real USDC");
  expect(errors).toEqual([]);
});

test("'Programs you joined' and the owner's lists follow the switch; each card shows its network", async ({
  browser,
}) => {
  const stamp = Date.now();
  const ctx = await browser.newContext();
  const wallet = await injectWallet(ctx, generatePrivateKey());
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);
  const ownerId = await userIdForWallet(db, wallet.address);
  const t1 = await seedProgram(db, { ownerId, slug: `own-t1-${stamp}`, name: "Test One" });
  await seedProgram(db, { ownerId, slug: `own-t2-${stamp}`, name: "Test Two" });
  const m1 = await seedProgram(db, {
    ownerId,
    slug: `own-m1-${stamp}`,
    name: "Main One",
    chain: "arc-mainnet",
  });

  // Owner: Testnet shows the two testnet campaigns only.
  await page.goto("/app/programs");
  const cards = page.getByRole("region", { name: "Programs", exact: true });
  await expect(cards.getByRole("article")).toHaveCount(2);
  await expect(cards.getByRole("article").first()).toContainText("Testnet");
  await expect(cards).not.toContainText("Main One");
  await pickNetwork(page, "Arc Mainnet");
  await expect(cards.getByRole("article")).toHaveCount(1);
  await expect(cards.getByRole("article").first()).toContainText("Main One");
  await expect(cards.getByRole("article").first()).toContainText("Mainnet");

  // Contributor: joined one of each.
  const x = { id: `93${stamp}`, handle: "two_nets" };
  const { userId, cookie } = await contributorSession(db, x);
  await seedMember(db, { programId: t1, userId, x, wallet: `0x${"ef".repeat(20)}` });
  await seedMember(db, { programId: m1, userId, x, wallet: `0x${"ef".repeat(20)}` });
  await ctx.addCookies([cookie]);
  await page.goto("/c");
  const joined = page.getByRole("region", { name: "Programs you joined" });
  await expect(joined.getByRole("article")).toHaveCount(1);
  await expect(joined.getByRole("article")).toContainText("Main One");
  await expect(joined.getByRole("article")).toContainText("Mainnet");
  await expect(page.getByText("Earned on Arc Mainnet")).toBeVisible();
  await pickNetwork(page, "Arc Testnet");
  await expect(joined.getByRole("article")).toHaveCount(1);
  await expect(joined.getByRole("article")).toContainText("Test One");
  await expect(joined.getByRole("article")).toContainText("Testnet");
  expect(errors).toEqual([]);
});

test.describe("on a deployment with an Arc Mainnet agent", () => {
  test.skip(!!process.env.E2E_DEV, "the mainnet server runs from the production build only");
  test.use({ baseURL: E2E.mainnetURL });

  test("wizard: Mainnet needs the 'real USDC' confirmation, suggests safe limits, and creates a mainnet campaign", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ baseURL: E2E.mainnetURL });
    const wallet = await injectWallet(ctx, generatePrivateKey());
    const { page, errors } = await newPage(ctx);
    await ownerSignIn(page);
    const slug = `wiz-main-${Date.now()}`;
    await page.goto("/app/programs/new");
    await page.getByLabel("Program name").fill("Wizard Mainnet");
    await page.getByLabel("Join link").fill(slug);
    await page.getByLabel("Description").fill("A mainnet campaign made in the e2e wizard.");
    await expect(page.getByRole("radio", { name: /Arc Testnet/ })).toBeChecked();
    await page.getByRole("radio", { name: /Arc Mainnet/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Confirm that this campaign pays real USDC")).toBeVisible();
    await page.getByRole("checkbox", { name: /pays real USDC on Arc Mainnet/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Here's what I understood" })).toBeVisible();
    await page
      .getByLabel("About this program")
      .fill(
        "Wizard Mainnet pays for clear posts about building payment apps on Arc. Avoid price talk and memes.",
      );
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Category 1")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    // Safe starting limits for real USDC: low caps, every round waits for the owner.
    await expect(page.getByTestId("mainnet-limits")).toContainText(
      "every round waits for your approval",
    );
    expect(
      Number(await page.getByLabel("Max per contributor per round").inputValue()),
    ).toBeLessThanOrEqual(5);
    expect(Number(await page.getByLabel("Max per round").inputValue())).toBeLessThanOrEqual(25);
    expect(
      Number(await page.getByLabel("Max per rolling 24 hours").inputValue()),
    ).toBeLessThanOrEqual(25);
    expect(Number(await page.getByLabel("Your approval needed above").inputValue())).toBe(0);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Arc Mainnet · pays real USDC")).toBeVisible();
    await expect(page.getByText("Your approval for every round")).toBeVisible();
    await page.getByRole("button", { name: "Create program" }).click();
    await expect(page).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/ready$/);
    const { rows } = await db.query<{
      chain: string;
      limits_json: { autoApproveThreshold: string };
    }>("select chain, limits_json from programs where slug = $1", [slug]);
    expect(rows[0]).toMatchObject({
      chain: "arc-mainnet",
      limits_json: { autoApproveThreshold: "0" },
    });
    void wallet;
    expect(errors).toEqual([]);
  });

  test("wrong network: a mainnet campaign's action asks the wallet to switch to Arc Mainnet, adding it if needed", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ baseURL: E2E.mainnetURL });
    // On Arc Testnet, and the wallet doesn't know Arc Mainnet yet.
    const wallet = await injectWallet(ctx, generatePrivateKey(), 5042002, [5042002]);
    const { page, errors } = await newPage(ctx);
    await ownerSignIn(page);
    const ownerId = await userIdForWallet(db, wallet.address);
    const id = await seedProgram(db, {
      ownerId,
      slug: `wrong-net-${Date.now()}`,
      chain: "arc-mainnet",
      status: "draft",
    });
    await page.goto(`/app/programs/${id}/setup`);
    await expect(page.getByTestId("network-badge").first()).toHaveText(/Mainnet/);
    await page.getByRole("button", { name: "Deploy vault" }).click();
    const fix = page.getByRole("dialog", { name: "Switch to Arc Mainnet" });
    await expect(fix).toContainText("This action needs your wallet on Arc Mainnet.");
    await fix.getByRole("button", { name: "Switch network" }).click();
    await expect(fix).toBeHidden();
    // The wallet is on Arc Mainnet now (added, then switched).
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { ethereum: { request: (a: { method: string }) => Promise<string> } }
        ).ethereum.request({
          method: "eth_chainId",
        }),
      ),
    ).toBe("0x13b2");
    expect(errors).toEqual([]);
  });
});
