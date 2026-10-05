/**
 * axe-core on every main page (light and dark), signed in as the seeded owner / contributor where needed.
 * Fails on serious or critical violations. Run against the showcase stack:
 *
 *   SHOW_BASE=http://localhost:3200 pnpm --filter @misthos/web exec tsx scripts/axe.mts
 */
import AxeBuilder from "@axe-core/playwright";
import nextEnv from "@next/env";
import { chromium } from "@playwright/test";
import { SignJWT } from "jose";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
nextEnv.loadEnvConfig(root);
const BASE = process.env.SHOW_BASE ?? "http://localhost:3200";
const show = JSON.parse(readFileSync(path.join(root, "apps/worker/scripts/.showcase.json"), "utf8")) as {
  programId: string;
  setupProgramId: string;
  slug: string;
  ownerUserId: string;
  owner: string;
  contributor: { userId: string; xid: string };
  round1: string;
};
const key = new TextEncoder().encode(process.env.SESSION_SECRET!);
const token = (c: Record<string, unknown>) =>
  new SignJWT(c).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setIssuer("misthos").setExpirationTime("2h").sign(key);
const owner = await token({ sub: show.ownerUserId, kind: "owner", addr: show.owner.toLowerCase() });
const contributor = await token({ sub: show.contributor.userId, kind: "contributor", xid: show.contributor.xid, xh: "alice_builds" });

const PAGES: [string, string, "owner" | "contributor" | null, string?][] = [
  ["Landing", "/", null],
  ["Docs", "/docs", null],
  ["Join", `/join/${show.slug}`, null],
  ["Public audit", `/p/${show.slug}`, null],
  ["Round receipt", `/p/${show.slug}/rounds/${show.round1}`, null],
  ["404", "/nope", null],
  ["Owner sign-in", "/app", null],
  ["Programs", "/app/programs", "owner"],
  ["Program overview", `/app/programs/${show.programId}`, "owner"],
  ["New program overview", `/app/programs/${show.setupProgramId}`, "owner"],
  ["Submissions", `/app/programs/${show.programId}/submissions`, "owner"],
  ["Contributors", `/app/programs/${show.programId}/contributors`, "owner"],
  ["Submissions board", `/app/programs/${show.programId}/submissions?view=board`, "owner"],
  ["Submission drawer", `/app/programs/${show.programId}/submissions`, "owner", "Review submission by @carol_writes"],
  ["Flagged drawer", `/app/programs/${show.programId}/submissions`, "owner", "Review submission by @eve_tests"],
  ["Rounds", `/app/programs/${show.programId}/rounds`, "owner"],
  ["Round detail", `/app/programs/${show.programId}/rounds/${show.round1}`, "owner"],
  ["Treasury", `/app/programs/${show.programId}/treasury`, "owner"],
  ["Audit log", `/app/programs/${show.programId}/audit`, "owner"],
  ["Settings", `/app/programs/${show.programId}/settings`, "owner"],
  ["Wizard", "/app/programs/new", "owner"],
  ["Contributor home", "/c", "contributor"],
  ["Contributor program", `/c/${show.slug}`, "contributor"],
  ["Program ready", `/app/programs/${show.setupProgramId}/ready`, "owner"],
  ["Setup (deploy)", `/app/programs/${show.setupProgramId}/setup`, "owner"],
  ["Setup (live)", `/app/programs/${show.programId}/setup`, "owner"],
  ["Empty submissions", `/app/programs/${show.setupProgramId}/submissions`, "owner"],
];

const browser = await chromium.launch();
const results: { page: string; theme: string; serious: { id: string; impact: string; nodes: number; help: string }[] }[] = [];
let bad = 0;
for (const theme of ["light", "dark"] as const) {
  for (const [name, url, who, click] of PAGES) {
    const ctx = await browser.newContext({ colorScheme: theme, baseURL: BASE });
    await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
    if (who === "owner") await ctx.addCookies([{ name: "misthos_owner", value: owner, url: BASE }]);
    if (who === "contributor") await ctx.addCookies([{ name: "misthos_contributor", value: contributor, url: BASE }]);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    if (click) {
      await page.getByRole("button", { name: click }).first().click();
      await page.getByRole("dialog").waitFor();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
    }
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = r.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, impact: v.impact!, nodes: v.nodes.length, help: v.help, target: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
    if (serious.length) bad++;
    results.push({ page: name, theme, serious });
    console.log(`${serious.length ? "FAIL" : "ok  "} ${theme.padEnd(5)} ${name}${serious.length ? `: ${serious.map((s) => `${s.id} (${s.nodes}) ${JSON.stringify((s as { target: string[] }).target)}`).join("; ")}` : ""}`);
    await ctx.close();
  }
}
await browser.close();
mkdirSync(path.join(root, "docs/test-results"), { recursive: true });
writeFileSync(path.join(root, "docs/test-results/axe.json"), JSON.stringify(results, null, 2));
process.exit(bad ? 1 : 0);
