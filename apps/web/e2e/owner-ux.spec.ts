import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { generatePrivateKey } from "viem/accounts";
import { E2E } from "../playwright.config";
import { injectWallet } from "./wallet";

/**
 * Regression tests for the owner's feedback (UX audit OF-1 … OF-19): wizard state, schedule, switcher, wallet
 * reconnect, nav focus, empty states and audit labels. Runs against the throwaway e2e database; no chain needed.
 */

async function signIn(page: Page) {
  await page.goto("/app");
  await page
    .getByRole("button", { name: /^connect/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await dialog.getByRole("button", { name: /metamask/i }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Misthos" })).toBeVisible();
}

test("owner flow: wizard keeps its state, starts Round 1 now, and the app shell stays in sync", async ({
  browser,
}) => {
  const db = new pg.Client({ connectionString: E2E.dbUrl });
  await db.connect();
  try {
    // 1360×900 like a laptop: the Continue button is on screen without scrolling (see the lost-click check below).
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await injectWallet(ctx, generatePrivateKey());
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await signIn(page);

    // OF-17: the welcome screen offers the next step and a live example when one exists.
    await expect(page.getByRole("link", { name: "Create your first program" })).toBeVisible();

    // ── OF-2, OF-8: wizard state survives Back, browser back/forward and a refresh ──
    await page.getByRole("link", { name: "Create your first program" }).click();
    await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
    await page.getByLabel("Program name").fill("Kency Arc Creators");
    await expect(page.locator("#slug")).toHaveValue("kency-arc-creators"); // filled from the name
    // Editable, and once edited the name no longer overwrites it.
    await page.locator("#slug").fill("kency-creators");
    await page.getByLabel("Program name").fill("Kency Arc Creators!");
    await expect(page.locator("#slug")).toHaveValue("kency-creators");
    await page.locator("#slug").fill("kency-arc-creators");
    await page.getByLabel("Program name").fill("Kency Arc Creators");
    // Leave Description empty once: its error shows in plain words…
    await page.getByLabel("Description").click();
    await page.getByLabel("Program name").click();
    await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
    // …and clears while typing, so the first Continue click lands (it used to shift the button mid-click).
    await page
      .getByLabel("Description")
      .fill("Pays creators for original threads about building on Arc.");
    await expect(page.getByText("Use at least 10 characters.")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/step=2/, { timeout: 3_000 });
    await page.goBack();
    await expect(page.getByLabel("Program name")).toHaveValue("Kency Arc Creators");
    await page.reload();
    await expect(page.getByLabel("Program name")).toHaveValue("Kency Arc Creators");
    await expect(page.getByText(/Draft saved on this device/)).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // ── OF-9: how scores become USDC, live per category ──
    await expect(page.getByText("How a score becomes USDC")).toBeVisible();
    // OF/CJ copy: singular, with the score spelled out.
    await expect(
      page.getByText(/A perfect thread or post \(10\/10\) earns\s*5\.00 USDC/).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // ── OF-1, OF-10, OF-11: Now by default, 7-day rounds, safe derived limits, inline warnings ──
    await expect(page.getByRole("radio", { name: "Now" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#len")).toHaveValue("7");
    await expect(page.locator("#autoitem")).toHaveValue("10.00"); // = the best perfect submission
    await expect(page.locator("#perpayout")).toHaveValue("30.00");
    await page.locator("#threshold").fill("500");
    await expect(page.getByText(/you'd never be asked to approve/)).toBeVisible();
    await page.locator("#threshold").fill("50");
    await page.getByRole("radio", { name: "Schedule for later" }).click();
    await expect(page.getByText(/UTC · starts in/)).toBeVisible(); // local time, UTC, and how long until
    await page.getByRole("radio", { name: "Now" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Create program" }).click();
    await expect(page).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/ready$/);
    await page.getByRole("main").getByRole("link", { name: "Go to overview" }).click();
    await expect(page).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}$/);
    const programId = /programs\/([0-9a-f-]{36})/.exec(page.url())![1]!;

    // ── OF-3: the switcher lists the new draft right away ──
    await expect(page.getByRole("button", { name: /switch program/i })).toContainText(
      "Kency Arc Creators",
    );

    // A single program: /app goes straight to it.
    await page.goto("/app");
    await expect(page).toHaveURL(new RegExp(`/app/programs/${programId}$`));

    // Round 1 started at creation, not days later.
    const { rows } = await db.query<{ starts: Date }>(
      "select starts_at as starts from rounds where program_id = $1 and number = 1",
      [programId],
    );
    expect(Math.abs(rows[0]!.starts.getTime() - Date.now())).toBeLessThan(5 * 60_000);

    // ── OF-4: after a reload the wallet reconnects by itself ──
    await expect(page.getByRole("button", { name: "Wallet ready", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();
    await expect(page.getByRole("button", { name: "Wallet ready", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: /^connect/i })).toHaveCount(0);

    // ── OF-6: a mouse click leaves no focus ring; keyboard focus still shows one ──
    await page.getByRole("link", { name: "Treasury" }).click();
    await expect(page).toHaveURL(/treasury/);
    expect(
      await page.evaluate(() => document.activeElement?.matches("a:focus-visible") ?? false),
    ).toBe(false);

    // ── OF-5: the sidebar footer shows the account without anything on top of it ──
    await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    // Nothing (e.g. the Next dev badge) sits on top of the footer: the button is the topmost element at its centre.
    expect(
      await signOut.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!top && el.contains(top);
      }),
    ).toBe(true);

    // ── OF-12: a real empty state with the join link once published ──
    await page.getByRole("link", { name: "Overview" }).click();
    await page.getByRole("button", { name: "Publish join page" }).click();
    await expect(page.getByText("active", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Submissions" }).click();
    await expect(page.getByRole("heading", { name: "No submissions yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy join link" })).toBeVisible();

    // ── OF-1: a scheduled round can't be closed and can be started from Settings (audited) ──
    await db.query(
      "update rounds set starts_at = now() + interval '6 days', ends_at = now() + interval '13 days' where program_id = $1",
      [programId],
    );
    await page.getByRole("link", { name: "Rounds" }).click();
    await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();
    await expect(page.getByText(/starts in 6 days/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Close round now" })).toBeDisabled();
    await page.getByRole("link", { name: "Start it now" }).click();
    await page.getByRole("button", { name: "Start round 1 now" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start now" }).click();
    await expect(page.getByText("Round 1 has started.")).toBeVisible();
    await page.getByRole("link", { name: "Rounds" }).click();
    await expect(page.getByRole("region", { name: "Round 1 is open" })).toContainText("closes in");
    await expect(page.getByText("Scheduled", { exact: true })).toHaveCount(0);

    // ── OF-13: the audit log names who did it, in words ──
    await page.getByRole("link", { name: "Audit log" }).click();
    await expect(page.getByText("Round started early")).toBeVisible();
    await expect(page.getByText("round.started_early")).toBeVisible();
    await expect(page.getByRole("cell", { name: "You" }).first()).toBeVisible();

    expect(errors).toEqual([]);
  } finally {
    await db.end();
  }
});
