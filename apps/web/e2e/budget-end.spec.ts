import { expect, test } from "@playwright/test";
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
 * Budget safety and ending a campaign, in the browser. (Out-of-funds blocking needs a real vault balance; the e2e
 * vaults are chain-free, so that path is covered by the unit tests with an injected balance.)
 */

let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: E2E.dbUrl });
  await db.connect();
});
test.afterAll(async () => db.end());

const ENDED = "This campaign has ended. Thanks for contributing!";

test("the owner ends a campaign: confirm dialog, Ended on the overview, and contributors are thanked with no submit box", async ({
  browser,
}) => {
  const key = generatePrivateKey();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await injectWallet(ctx, key);
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);
  const ownerId = await userIdForWallet(db, privateKeyToAccount(key).address);
  const stamp = Date.now();
  const slug = `ending-${stamp}`;
  const programId = await seedProgram(db, {
    ownerId,
    slug,
    name: `Ending ${stamp}`,
    vault: `0x${"e".repeat(39)}9`,
  });
  const x = { id: `91${stamp}`, handle: "ender" };
  const { userId, cookie } = await contributorSession(db, x);
  await seedMember(db, { programId, userId, x, wallet: `0x${"ef".repeat(20)}` });

  // Settings: End campaign → a dialog that says what happens → confirm.
  await page.goto(`/app/programs/${programId}/settings#end`);
  await page.getByRole("button", { name: "End campaign" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("This can't be undone.");
  await expect(dialog).toContainText("Closes normally and pays");
  await dialog.getByRole("button", { name: "End campaign" }).click();
  await expect(page.getByText(/Campaign ended\. The current round still pays/)).toBeVisible();
  await expect(page.getByRole("button", { name: "End campaign" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pause joining|Reopen joining/ })).toHaveCount(0);

  // Overview: "Ended", and the round still closes and pays.
  await page.goto(`/app/programs/${programId}`);
  const states = page.getByTestId("program-states");
  await expect(states).toContainText("Ended.");
  await expect(states).toContainText("Round 1 still closes");
  await expect(page.getByText("ended", { exact: true }).first()).toBeVisible();

  // Contributors: the join page and their dashboard thank them; there's no submit box.
  const c = await browser.newContext();
  await c.addCookies([cookie]);
  const cp = await c.newPage();
  await cp.goto(`/join/${slug}`);
  await expect(cp.getByTestId("campaign-ended")).toContainText(ENDED);
  await cp.goto(`/c/${slug}`);
  await expect(cp.getByTestId("submissions-closed")).toContainText(ENDED);
  await expect(cp.getByPlaceholder("Paste a link")).toHaveCount(0);
  // A visitor who isn't a member sees the same, with no way to join.
  const anon = await browser.newPage();
  await anon.goto(`/join/${slug}`);
  await expect(anon.getByTestId("campaign-ended")).toContainText(ENDED);
  await expect(anon.getByRole("link", { name: "Sign in with X" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("approved work the vault couldn't cover reads Waiting for funds, for the contributor and the owner", async ({
  browser,
}) => {
  const key = generatePrivateKey();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await injectWallet(ctx, key);
  const { page } = await newPage(ctx);
  await ownerSignIn(page);
  const ownerId = await userIdForWallet(db, privateKeyToAccount(key).address);
  const stamp = Date.now();
  const slug = `short-${stamp}`;
  const programId = await seedProgram(db, {
    ownerId,
    slug,
    name: `Short ${stamp}`,
    vault: `0x${"d".repeat(39)}8`,
  });
  const x = { id: `92${stamp}`, handle: "waiter" };
  const { userId, cookie } = await contributorSession(db, x);
  const cid = await seedMember(db, { programId, userId, x, wallet: `0x${"dc".repeat(20)}` });
  // As the round job leaves it: approved, not in a payout, marked waiting for funds.
  await db.query(
    `insert into submissions (program_id, round_id, contributor_id, url, source_type, resource_id, status, amount,
       waiting_for_funds_at)
     select $1, r.id, $2, 'https://x.com/waiter/status/1900000000000000001', 'x_post', '1900000000000000001',
       'approved', 1500000, now()
     from rounds r where r.program_id = $1 and r.number = 1`,
    [programId, cid],
  );

  await page.goto(`/app/programs/${programId}`);
  await expect(page.getByTestId("program-states")).toContainText(
    "1 approved item (1.50 USDC) is waiting for funds",
  );
  await expect(page.getByTestId("program-states")).toContainText("add funds to pay them");
  await page.goto(`/app/programs/${programId}/submissions?status=approved`);
  await expect(page.getByText("Waiting for funds").first()).toBeVisible();

  const c = await browser.newContext();
  await c.addCookies([cookie]);
  const cp = await c.newPage();
  await cp.goto(`/c/${slug}`);
  await expect(cp.getByText("Waiting for funds").first()).toBeVisible();
});
