import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { generatePrivateKey } from "viem/accounts";
import { E2E } from "../playwright.config";
import {
  connectWallet,
  contributorSession,
  newPage,
  ownerSignIn,
  seedMember,
  seedProgram,
  userIdForWallet,
} from "./helpers";
import { injectWallet } from "./wallet";

/**
 * Wallet edge cases with an injected test wallet (two accounts, switchable network, rejectable requests). The rules
 * under test: a wallet prompt only ever follows a click, and an account or network switch is a quiet hint (a chip dot
 * for owners, a line in the Account card for contributors), never a banner.
 */

/** E2E_SHOTS=1 saves the states these tests reach into docs/screenshots (light theme, 1440 px). */
async function shot(page: Page, name: string, target?: Locator) {
  if (!process.env.E2E_SHOTS) return;
  await page.waitForTimeout(300);
  const path = `../../docs/screenshots/${name}-light.png`;
  await (target ? target.screenshot({ path }) : page.screenshot({ path }));
}

const SHOWCASE_VAULT = "0x09138198c0056189727dfe809E67934c1B7fD973";
let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: E2E.dbUrl });
  await db.connect();
});
test.afterAll(async () => db.end());

test("owner: account and network switches show quietly in the wallet chip, the fix opens only when needed, and nothing asks for a signature", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const wallet = await injectWallet(ctx, [generatePrivateKey(), generatePrivateKey()]);
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);
  expect(wallet.signRequests).toHaveLength(1); // the sign-in itself
  const ownerId = await userIdForWallet(db, wallet.address);
  const programId = await seedProgram(db, { ownerId, slug: `w-owner-${Date.now()}` });
  // The guided setup's first step deploys the vault; its header carries the wallet chip.
  // Opened directly: two wallet islands (header chip + deploy) resolve together, and the wallet still reconnects.
  await page.goto(`/app/programs/${programId}/setup`);
  const chip = (name: string) => page.getByRole("button", { name, exact: true });
  await expect(chip("Wallet ready")).toBeVisible();

  // Switch to another account in the extension: a quiet indicator, no dialog until an action needs the wallet.
  await wallet.switchAccount(page, 1);
  await expect(chip("Other account in wallet (fix)")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Deploy vault" }).click();
  const fix = page.getByRole("dialog", { name: "Your wallet is on another account" });
  await expect(fix).toContainText("transactions here need that account");
  await expect(fix.getByRole("button", { name: "Choose account in wallet" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(fix).toBeHidden();
  await page.waitForTimeout(500);
  expect(wallet.signRequests).toHaveLength(1);

  // Switch back: the chip is ready again by itself.
  await wallet.switchAccount(page, 0);
  await expect(chip("Wallet ready")).toBeVisible();

  // Wrong network: the chip opens a one-click switch (adding Arc Testnet if needed).
  await wallet.setChain(page, 1);
  await chip("Wrong network (fix)").click();
  const network = page.getByRole("dialog", { name: /Switch to Arc/ });
  await network.getByRole("button", { name: /Switch to Arc/ }).click();
  await expect(network).toBeHidden();
  await expect(chip("Wallet ready")).toBeVisible();

  // A reload reconnects silently.
  await page.reload();
  await expect(chip("Wallet ready")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^connect/i })).toHaveCount(0);

  // Disconnect in the extension: the chip offers to connect; an action explains what it needs. Still no signature.
  await wallet.revoke(page);
  await expect(chip("Connect wallet (fix)")).toBeVisible();
  await page.getByRole("button", { name: "Deploy vault" }).click();
  await expect(page.getByRole("dialog", { name: "Connect your wallet" })).toBeVisible();
  expect(wallet.signRequests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("owner: a declined signature or connection explains itself and can be retried", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const wallet = await injectWallet(ctx, generatePrivateKey());
  const { page, errors } = await newPage(ctx);
  await page.goto("/app");

  // Declined connection in the picker.
  await wallet.rejectNext(page, "wallet_requestPermissions");
  await page
    .getByRole("button", { name: /^connect/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await dialog.getByRole("button", { name: /metamask/i }).click();
  await expect(dialog.getByRole("alert")).toContainText("You declined the request in your wallet.");
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog).toBeHidden();

  // Declined signature.
  await wallet.rejectNext(page, "personal_sign");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "You declined the signature" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Misthos" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("WalletConnect's expired proposal (an unhandled rejection) becomes a calm message with a retry", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await injectWallet(ctx, generatePrivateKey());
  const { page, errors } = await newPage(ctx);
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  await page.goto("/app");
  await expect(page.getByRole("button", { name: /^connect/i }).first()).toBeVisible();

  // Exactly what @walletconnect/utils does when a pairing proposal times out: a rejected promise nobody awaits.
  await page.evaluate(() => {
    const e = new Error("Proposal expired");
    e.stack =
      "Error: Proposal expired\n    at https://localhost/_next/static/chunks/node_modules_@walletconnect_utils_dist_index.js:1:1";
    void Promise.reject(e);
  });
  await expect(page.getByText("Connection request expired. Try again.")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("dialog", { name: "Connect a wallet" })).toBeVisible();
  expect(errors).toEqual([]);
  expect(consoleErrors.filter((t) => /Proposal expired/.test(t))).toEqual([]);
});

test("contributor: another wallet in the extension is a quiet note, never a banner; signing still needs a click", async ({
  browser,
}) => {
  const owner = await db.query<{ id: string }>(
    "insert into users (wallet_address) values ($1) returning id",
    [`0x${Date.now().toString(16).padStart(40, "c")}`],
  );
  const slug = `w-payout-${Date.now()}`;
  const programId = await seedProgram(db, { ownerId: owner.rows[0]!.id, slug });
  const x = { id: `77${Date.now()}`, handle: "payout_tester" };
  const { userId, cookie } = await contributorSession(db, x);
  const ctx = await browser.newContext();
  await ctx.addCookies([cookie]);
  const wallet = await injectWallet(ctx, [generatePrivateKey(), generatePrivateKey()]);
  await seedMember(db, { programId, userId, x, wallet: wallet.addresses[0]! });
  const { page, errors } = await newPage(ctx);

  // Connect the payout wallet (as a returning visitor would have). Asking to change wallets while the extension is
  // still on the payout account is the one case that interrupts: a compact dialog to pick another account.
  await page.goto(`/c/${slug}`);
  await page.getByRole("button", { name: "Change payout wallet" }).click();
  await connectWallet(page);
  const pick = page.getByRole("dialog", { name: "Pick the new wallet" });
  await expect(pick).toBeVisible();
  await shot(page, "contributor-wallet-pick-dialog", pick);
  await pick.getByRole("button", { name: "Cancel" }).click();
  await expect(pick).toBeHidden();

  // Another account in the extension: no banner anywhere, just a line under the payout wallet.
  await wallet.switchAccount(page, 1);
  await page.reload();
  const note = page.getByText("Connected wallet differs from your payout wallet");
  await expect(note).toBeVisible({ timeout: 15_000 });
  await shot(
    page,
    "contributor-wallet-note",
    page.locator("section", { hasText: "Payout wallet" }).last(),
  );
  await expect(page.getByRole("status").filter({ hasText: /payout wallet/i })).toHaveCount(0);
  expect(wallet.signRequests).toHaveLength(0);

  // "Use this wallet instead" opens the change flow with the connected account; the signature waits for a click.
  await page.getByRole("button", { name: "Use this wallet instead" }).click();
  await expect(page.getByRole("button", { name: "Sign to switch wallet" })).toBeVisible();
  await expect(pick).toBeHidden();
  await page.waitForTimeout(500);
  expect(wallet.signRequests).toHaveLength(0);

  // Back on the payout account: the note goes, and the change flow asks to pick another account again.
  await wallet.switchAccount(page, 0);
  await expect(note).toBeHidden();
  await expect(pick).toBeVisible();
  // Switching in the wallet closes it by itself.
  await wallet.switchAccount(page, 1);
  await expect(pick).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign to switch wallet" })).toBeVisible();
  expect(wallet.signRequests).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("owner: depositing more USDC than the wallet holds is refused before any prompt", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const wallet = await injectWallet(ctx, generatePrivateKey());
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);
  const ownerId = await userIdForWallet(db, wallet.address);
  const programId = await seedProgram(db, {
    ownerId,
    slug: `w-funds-${Date.now()}`,
    vault: SHOWCASE_VAULT,
  });
  await page.goto(`/app/programs/${programId}/treasury`);
  // Wallet forms load once they're on screen: scroll to the deposit form, as a person would.
  await page.getByRole("heading", { name: "Add funds" }).scrollIntoViewIfNeeded();
  // A brand-new wallet holds no test USDC (read from Arc testnet).
  await expect(page.getByText(/Your wallet has 0\.00 USDC/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Amount to deposit").fill("5");
  // Said once, next to the amount (not repeated under the button).
  await expect(page.getByText("That's more than your wallet holds.")).toHaveCount(1);
  await expect(page.getByText("Fix the amount above.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fund vault" })).toBeDisabled();
  expect(errors).toEqual([]);
});
