import { expect, test, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import pg from "pg";
import { generatePrivateKey } from "viem/accounts";
import { E2E } from "../playwright.config";
import { injectWallet } from "./wallet";

/**
 * Owner signs in with a wallet (SIWE), creates and publishes a program; a contributor joins with a signed wallet
 * proof, then switches wallets. Runs against the throwaway e2e database.
 *
 * X OAuth can't be automated without a real X account, so the test plays the OAuth callback's part: it creates the
 * X user row and issues the same signed session cookie the callback would. The OAuth code itself is unit-tested.
 */

const SLUG = "e2e-builders";
const X = { id: "1000000001", handle: "e2e_alice" };

async function connectWallet(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  // Some buttons open the picker by themselves once the wallet code loads (e.g. "Change payout wallet").
  await dialog.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (!(await dialog.isVisible()))
    await page
      .getByRole("button", { name: /^connect/i })
      .first()
      .click();
  await dialog.getByRole("button", { name: /metamask/i }).click();
  // The picker closes once the wallet connects.
  await expect(dialog).toBeHidden();
}

async function contributorCookie(db: pg.Client) {
  const { rows } = await db.query<{ id: string }>(
    "insert into users (x_user_id, x_handle) values ($1, $2) on conflict (x_user_id) do update set x_handle = excluded.x_handle returning id",
    [X.id, X.handle],
  );
  const token = await new SignJWT({
    sub: rows[0]!.id,
    kind: "contributor",
    xid: X.id,
    xh: X.handle,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("misthos")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
  return {
    name: "misthos_contributor",
    value: token,
    url: E2E.baseURL,
    httpOnly: true,
    sameSite: "Lax" as const,
  };
}

test("owner creates and publishes a program; contributor joins and switches wallet", async ({
  browser,
}) => {
  const db = new pg.Client({ connectionString: E2E.dbUrl });
  await db.connect();
  // Other specs share this database: every check below is scoped to this test's program and time window.
  const since = new Date(Date.now() - 1000);
  try {
    // ── Owner ──────────────────────────────────────────────────────────────
    const ownerCtx = await browser.newContext();
    const owner = await injectWallet(ownerCtx, generatePrivateKey());
    const op = await ownerCtx.newPage();
    const errors: string[] = [];
    op.on("pageerror", (e) => errors.push(e.message));

    await op.goto("/app");
    await expect(op.getByRole("heading", { name: "Sign in to Misthos" })).toBeVisible();
    await connectWallet(op);
    await op.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(op.getByRole("heading", { name: "Welcome to Misthos" })).toBeVisible();
    await expect(op.getByText("Your first program takes about five minutes")).toBeVisible();

    await op.getByRole("link", { name: "Create your first program" }).click();
    await op.getByLabel("Program name").fill("E2E Builders");
    await expect(op.getByLabel("Join link")).toHaveValue(SLUG);
    await op.getByLabel("Description").fill("End-to-end test program that pays for Arc content.");
    await op.getByRole("button", { name: "Continue" }).click();
    await expect(op.getByText("Category 1")).toBeVisible();
    await op.getByRole("button", { name: "Continue" }).click();
    await expect(op.getByRole("heading", { name: "Vault limits" })).toBeVisible();
    // Guardrail validation mirrors the contract: per-round cap below per-payout cap is refused.
    await op.getByLabel("Max per round").fill("10");
    await op.getByRole("button", { name: "Continue" }).click();
    await expect(op.getByText("Must be at least the per-payout cap")).toBeVisible();
    await op.getByLabel("Max per round").fill("1000");
    await op.getByLabel("Max per rolling 24 hours").fill("2000");
    await op.getByRole("button", { name: "Continue" }).click();
    await expect(op.getByText(/rounds above 50\.00 USDC/)).toBeVisible();
    await op.getByRole("button", { name: "Create program" }).click();

    // "Your program is ready", then on to the overview.
    await expect(op).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/ready$/);
    await expect(op.getByRole("heading", { name: "Your program is ready" })).toBeVisible();
    await expect(op.getByRole("link", { name: "Set up the vault" })).toHaveAttribute(
      "href",
      /\/setup$/,
    );
    // The guided setup's first step is the vault deploy; Back returns to the ready screen.
    await op.getByRole("link", { name: "Set up the vault" }).click();
    await expect(op).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/setup$/);
    await expect(op.getByRole("button", { name: "Deploy vault" })).toBeVisible();
    await op.goBack();
    await expect(op.getByRole("heading", { name: "Your program is ready" })).toBeVisible();
    await op.getByRole("main").getByRole("link", { name: "Go to overview" }).click();
    await expect(op).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}$/);
    await expect(op.getByRole("heading", { name: "E2E Builders" })).toBeVisible();
    await expect(op.getByText("draft", { exact: true })).toBeVisible();
    await expect(op.getByRole("region", { name: "Get your program live" })).toContainText(
      "0 of 5 done",
    );
    await op.getByRole("button", { name: "Publish join page" }).click();
    await expect(op.getByText("active", { exact: true })).toBeVisible();
    await op.getByRole("link", { name: "Settings" }).click();
    await expect(op.getByText(`localhost:3100/join/${SLUG}`)).toBeVisible();
    await expect(op.getByRole("button", { name: "Copy join link" })).toBeVisible();

    // ── Contributor joins ──────────────────────────────────────────────────
    const cookie = await contributorCookie(db);
    const c1 = await browser.newContext();
    await c1.addCookies([cookie]);
    const wallet1 = await injectWallet(c1, generatePrivateKey());
    const cp = await c1.newPage();
    cp.on("pageerror", (e) => errors.push(e.message));

    await cp.goto(`/join/${SLUG}`);
    await expect(cp.getByRole("heading", { name: "E2E Builders" })).toBeVisible();
    await expect(cp.getByText(`@${X.handle}`)).toBeVisible();
    await connectWallet(cp);
    await cp.getByRole("button", { name: "Sign and join" }).click();
    await expect(cp).toHaveURL(new RegExp(`/c/${SLUG}$`));
    await expect(cp.getByRole("heading", { name: "Your contributions" })).toBeVisible();
    // GitHub is only ever linked through OAuth; a fresh contributor sees the connect button and can't
    // submit GitHub work until they do.
    await expect(cp.getByRole("link", { name: "Connect GitHub" })).toBeVisible();

    // ── Contributor switches to a second wallet ────────────────────────────
    const c2 = await browser.newContext();
    await c2.addCookies([cookie]);
    const wallet2 = await injectWallet(c2, generatePrivateKey());
    const cp2 = await c2.newPage();
    await cp2.goto(`/c/${SLUG}`);
    await cp2.getByRole("button", { name: "Change payout wallet" }).click();
    await connectWallet(cp2);
    await cp2.getByRole("button", { name: "Sign to switch wallet" }).click();
    await expect(cp2.getByText(/You changed your wallet recently/)).toBeVisible();

    // ── Owner sees the contributor and the wallet-change flag ──────────────
    await op.getByRole("link", { name: "Overview" }).click();
    await expect(
      op
        .getByRole("region", { name: "Needs you" })
        .getByText(`@${X.handle} changed their payout wallet`),
    ).toBeVisible();
    await op.getByRole("link", { name: "Contributors" }).click();
    await expect(op.getByRole("link", { name: `@${X.handle}` })).toBeVisible();

    // ── Database state ─────────────────────────────────────────────────────
    const c = await db.query(
      `select wallet_address, wallet_changed_at, github_login, wallet_proof_message from contributors
       where program_id = (select id from programs where slug = $1)`,
      [SLUG],
    );
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].wallet_address).toBe(wallet2.address.toLowerCase());
    expect(c.rows[0].wallet_changed_at).not.toBeNull();
    expect(c.rows[0].github_login).toBeNull();
    expect(c.rows[0].wallet_proof_message).toContain(`@${X.handle} (${X.id})`);

    // The program's owner is the wallet that signed in; the contributor's wallets never became users.
    const owners = await db.query(
      "select u.wallet_address from programs p join users u on u.id = p.owner_user_id where p.slug = $1",
      [SLUG],
    );
    expect(owners.rows.map((r) => r.wallet_address)).toEqual([owner.address.toLowerCase()]);
    const strays = await db.query("select 1 from users where wallet_address = any($1)", [
      [wallet1.address.toLowerCase(), wallet2.address.toLowerCase()],
    ]);
    expect(strays.rows).toHaveLength(0);

    const signedIn = await db.query(
      "select 1 from audit_events where action = 'owner.signed_in' and created_at >= $1",
      [since],
    );
    expect(signedIn.rows.length).toBeGreaterThan(0);
    const audit = await db.query<{ action: string; data_json: Record<string, string> }>(
      `select action, data_json from audit_events
       where program_id = (select id from programs where slug = $1) order by created_at`,
      [SLUG],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "program.created",
      "program.published",
      "contributor.joined",
      "contributor.wallet_changed",
    ]);
    const change = audit.rows.at(-1)!.data_json;
    expect(change).toEqual({
      from: wallet1.address.toLowerCase(),
      to: wallet2.address.toLowerCase(),
    });

    // Every nonce issued was consumed exactly once.
    const nonces = await db.query(
      "select count(*)::int n, count(used_at)::int used from auth_nonces where created_at >= $1",
      [since],
    );
    expect(nonces.rows[0]).toEqual({ n: 3, used: 3 });

    // The audit log can't be rewritten, even with direct database access.
    await expect(db.query("update audit_events set action = 'tampered'")).rejects.toThrow(
      /append-only/,
    );

    expect(errors).toEqual([]);
  } finally {
    await db.end();
  }
});
