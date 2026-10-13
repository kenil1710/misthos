import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { generatePrivateKey } from "viem/accounts";
import { E2E } from "../playwright.config";
import { newPage, ownerSignIn, seedProgram, userIdForWallet } from "./helpers";
import { injectWallet } from "./wallet";

/**
 * Closing a round early. The e2e stack has no worker, so the close request is answered as the API does (202) and the
 * worker's part (close this round, open the next) is done in the database while the page waits.
 */

let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: E2E.dbUrl });
  await db.connect();
});
test.afterAll(async () => db.end());

const pill = (page: Page) =>
  page
    .getByText(/^Round \d+ · /)
    .filter({ visible: true })
    .first();

test("rounds: closing an empty round asks first, the header pill follows the next open round, empty rounds say 'No payouts'", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const wallet = await injectWallet(ctx, generatePrivateKey());
  const { page, errors } = await newPage(ctx);
  await ownerSignIn(page);
  const ownerId = await userIdForWallet(db, wallet.address);
  const programId = await seedProgram(db, {
    ownerId,
    slug: `rounds-${Date.now()}`,
    name: "Rounds UX",
    vault: `0x${"12".repeat(20)}`,
  });
  // Like production: Rounds 1 and 2 closed early with nothing approved, Round 3 open.
  await db.query(
    `update rounds set status = 'closed', starts_at = now() - interval '3 hours',
       ends_at = now() - interval '2 hours', closed_at = now() - interval '2 hours' where program_id = $1`,
    [programId],
  );
  await db.query(
    `insert into rounds (program_id, number, status, starts_at, ends_at, closed_at) values
       ($1, 2, 'closed', now() - interval '2 hours', now() - interval '1 hour', now() - interval '1 hour'),
       ($1, 3, 'open', now() - interval '1 hour', now() + interval '7 days' - interval '1 hour', null)`,
    [programId],
  );

  await page.goto(`/app/programs/${programId}/rounds`);
  await expect(pill(page)).toHaveText(/^Round 3 · closes in 6d 2\dh$/);
  await expect(page.getByRole("region", { name: "Round 3 is open" })).toBeVisible();
  // Empty closed rounds stay listed and say so.
  await expect(page.getByRole("link", { name: "Round 1", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Round 2", exact: true })).toBeVisible();
  await expect(page.getByText("No payouts", { exact: true })).toHaveCount(2);

  const closes: string[] = [];
  await page.route("**/api/owner/rounds/*/close", async (route) => {
    closes.push(route.request().url());
    await route.fulfill({ status: 202, json: { ok: true } });
  });

  // Nothing approved: it asks first, and Cancel sends nothing.
  await page.getByRole("button", { name: "Close round now" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Nothing is approved in this round. Close it anyway?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(closes).toEqual([]);

  await page.getByRole("button", { name: "Close round now" }).click();
  await dialog.getByRole("button", { name: "Close anyway" }).click();
  await expect.poll(() => closes.length).toBe(1);

  // The worker closes Round 3 and opens Round 4 a few seconds later; the page catches up without a reload.
  await db.query(
    "update rounds set status = 'closed', ends_at = now(), closed_at = now() where program_id = $1 and number = 3",
    [programId],
  );
  await db.query(
    `insert into rounds (program_id, number, status, starts_at, ends_at)
     values ($1, 4, 'open', now(), now() + interval '7 days')`,
    [programId],
  );
  await expect(pill(page)).toHaveText(/^Round 4 · closes in (6d 23h|7d)/, { timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Round 4 is open" })).toBeVisible();
  await expect(page.getByText("No payouts", { exact: true })).toHaveCount(3);
  expect(errors).toEqual([]);
});
