import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { generatePrivateKey } from "viem/accounts";
import { E2E } from "../playwright.config";
import {
  contributorSession,
  ownerSignIn,
  seedMember,
  seedProgram,
  userIdForWallet,
  walletModal,
} from "./helpers";
import { injectWallet } from "./wallet";

test("axe: no serious or critical issues on landing, docs, sign-in, the wallet list, overview, settings, join and contributor pages, light and dark", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const db = new pg.Client({ connectionString: E2E.dbUrl });
  await db.connect();
  const results: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const wallet = await injectWallet(ctx, generatePrivateKey());
    const page = await ctx.newPage();
    const scan = async (name: string) => {
      await page.waitForTimeout(800);
      const r = await new AxeBuilder({ page }).analyze();
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      results.push(
        `${scheme} ${name}: ${bad.length ? bad.map((v) => `${v.id} (${v.nodes.length})`).join(", ") : "ok"}`,
      );
    };
    await page.goto("/");
    await scan("landing");
    await page.goto("/docs");
    await scan("docs");
    await page.goto("/app");
    await scan("sign-in");
    await page
      .getByRole("button", { name: /^connect/i })
      .first()
      .click();
    await walletModal(page).waitFor();
    await scan("rainbowkit modal");
    await page.keyboard.press("Escape");
    await ownerSignIn(page);
    const ownerId = await userIdForWallet(db, wallet.address);
    const slug = `axe-${scheme}-${Date.now()}`;
    const programId = await seedProgram(db, { ownerId, slug });
    await db.query(
      "update programs set min_x_followers = 100, below_minimum = 'reject' where id = $1",
      [programId],
    );
    await page.goto(`/app/programs/${programId}`);
    await scan("overview (rules card)");
    await page.goto(`/app/programs/${programId}/settings`);
    await scan("settings (rules)");
    const x = { id: `87${Date.now()}`, handle: `axe_${scheme}` };
    const { userId, cookie } = await contributorSession(db, x);
    await db.query("update users set x_followers = 12 where id = $1", [userId]);
    await page.goto(`/join/${slug}`);
    await scan("join (signed out)");
    await ctx.addCookies([cookie]);
    await page.goto(`/join/${slug}`);
    await scan("join (below minimum)");
    await seedMember(db, { programId, userId, x, wallet: `0x${"56".repeat(20)}` });
    await page.goto(`/c/${slug}`);
    await scan("contributor page");
    await ctx.close();
  }
  await db.end();
  console.log(results.join("\n"));
  expect(results.filter((r) => !r.endsWith(": ok"))).toEqual([]);
});
