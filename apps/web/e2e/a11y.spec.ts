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

test("axe: the network switch and every page it changes, Testnet and Mainnet, light and dark", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const db = new pg.Client({ connectionString: E2E.dbUrl });
  await db.connect();
  const results: string[] = [];
  const pick = async (page: import("@playwright/test").Page, name: RegExp) => {
    await page.getByTestId("network-switch").filter({ visible: true }).first().click();
    await page.getByRole("menuitemradio", { name }).click();
  };
  for (const scheme of ["light", "dark"] as const) {
    for (const base of [E2E.baseURL, E2E.mainnetURL]) {
      if (base === E2E.mainnetURL && process.env.E2E_DEV) continue;
      const ctx = await browser.newContext({ colorScheme: scheme, baseURL: base });
      const wallet = await injectWallet(ctx, generatePrivateKey());
      const page = await ctx.newPage();
      const where = base === E2E.mainnetURL ? "mainnet server" : "main server";
      const scan = async (name: string) => {
        await page.waitForTimeout(800);
        const r = await new AxeBuilder({ page }).analyze();
        const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        results.push(
          `${scheme} ${where} ${name}: ${bad.length ? bad.map((v) => `${v.id} (${v.nodes.length})`).join(", ") : "ok"}`,
        );
      };
      await page.goto("/");
      await page.getByTestId("network-switch").filter({ visible: true }).first().click();
      await scan("network menu open");
      await page.getByRole("menuitemradio", { name: /Arc Mainnet/ }).click();
      await scan("landing on Mainnet");
      await ownerSignIn(page);
      const ownerId = await userIdForWallet(db, wallet.address);
      await db.query("update users set is_founder = true where id = $1", [ownerId]);
      const stamp = `${scheme}-${Date.now()}`;
      await page.goto("/app");
      await scan("no campaigns on Mainnet (empty state)");
      const main = await seedProgram(db, { ownerId, slug: `axe-m-${stamp}`, chain: "arc-mainnet" });
      await seedProgram(db, { ownerId, slug: `axe-m2-${stamp}`, chain: "arc-mainnet" });
      await seedProgram(db, { ownerId, slug: `axe-t-${stamp}` });
      await page.goto("/app/programs");
      await scan("owner list on Mainnet (badges)");
      await page.goto(`/app/programs/${main}`);
      await scan("mainnet program overview (badge)");
      await page.goto(`/app/programs/${main}/setup`);
      await scan("mainnet setup (fund copy)");
      await page.goto("/app/admin/metrics");
      await scan("metrics (both networks)");
      await page.goto("/app/programs/new");
      await page.getByRole("radio", { name: /Arc Testnet/ }).waitFor();
      if (base === E2E.mainnetURL) {
        await page.getByRole("radio", { name: /Arc Mainnet/ }).check();
        await scan("wizard, Mainnet picked (confirmation)");
      } else await scan("wizard, Mainnet coming soon");
      await page.goto(`/join/axe-m-${stamp}`);
      await scan("mainnet join page");
      await page.goto(`/p/axe-m-${stamp}`);
      await scan("mainnet public audit");
      const x = { id: `88${Date.now()}`, handle: `axe_n_${scheme}` };
      const { userId, cookie } = await contributorSession(db, x);
      await seedMember(db, { programId: main, userId, x, wallet: `0x${"57".repeat(20)}` });
      await ctx.addCookies([{ ...cookie, url: base }]);
      await page.goto("/c");
      await scan("programs you joined on Mainnet (badge)");
      await pick(page, /Arc Testnet/);
      await scan("programs you joined on Testnet (empty, other network offered)");
      await ctx.close();
    }
  }
  await db.end();
  console.log(results.join("\n"));
  expect(results.filter((r) => !r.endsWith(": ok"))).toEqual([]);
});
