import { expect, type BrowserContext, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import type pg from "pg";
import { E2E } from "../playwright.config";

/** Shared setup for the browser e2e specs: sign-in, sessions and seeded programs in the throwaway database. */

export const RUBRIC = {
  categories: [
    {
      key: "posts",
      name: "Threads and posts",
      description: "Original threads that teach something about building on Arc.",
      sourceTypes: ["x_post"],
      maxPoints: 10,
      criteria: [{ key: "depth", name: "Depth", description: "Explains how or why." }],
      rules: "",
      requireMerged: true,
    },
  ],
  generalRules: "",
};
export const LIMITS = {
  maxPerPayout: "30000000",
  maxPerRound: "150000000",
  maxPerDay: "300000000",
  autoApproveThreshold: "50000000",
  payeeCooldownSeconds: 86400,
  maxAutoApproveItem: "10000000",
};

/** Connect the injected test wallet through the app's own wallet picker. */
export async function connectWallet(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await dialog.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (!(await dialog.isVisible()))
    await page
      .getByRole("button", { name: /^connect/i })
      .first()
      .click();
  await dialog.getByRole("button", { name: /metamask/i }).click();
  await expect(dialog).toBeHidden();
}

/** Real owner sign-in: connect the wallet, sign the SIWE message (sets the session and the landing hint). */
export async function ownerSignIn(page: Page) {
  await page.goto("/app").catch(() => page.goto("/app"));
  await expect(page.getByRole("heading", { name: "Sign in to Misthos" })).toBeVisible();
  await connectWallet(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Misthos" })).toBeHidden();
}

export async function userIdForWallet(db: pg.Client, address: string) {
  const { rows } = await db.query<{ id: string }>(
    "select id from users where wallet_address = $1",
    [address.toLowerCase()],
  );
  return rows[0]!.id;
}

/** A program straight in the database (faster than the wizard when the test isn't about the wizard). */
export async function seedProgram(
  db: pg.Client,
  p: {
    ownerId: string;
    slug: string;
    name?: string;
    status?: "draft" | "active" | "paused";
    vault?: string | null;
    roundStartsInDays?: number;
  },
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into programs (slug, name, description, owner_user_id, chain, rubric_json, rate_per_point, limits_json,
       auto_approve_confidence, round_length_days, first_round_starts_at, status, vault_address)
     values ($1, $2, 'Pays for original threads about building on Arc.', $3, 'arc-testnet', $4, 500000, $5, 0.8, 7,
       now(), $6, $7) returning id`,
    [
      p.slug,
      p.name ?? p.slug,
      p.ownerId,
      JSON.stringify(RUBRIC),
      JSON.stringify(LIMITS),
      p.status ?? "active",
      p.vault ?? null,
    ],
  );
  const id = rows[0]!.id;
  await db.query(
    "insert into program_members (program_id, user_id, role) values ($1, $2, 'owner')",
    [id, p.ownerId],
  );
  const start = p.roundStartsInDays ?? -1;
  await db.query(
    `insert into rounds (program_id, number, starts_at, ends_at)
     values ($1, 1, now() + ($2 || ' days')::interval, now() + ($3 || ' days')::interval)`,
    [id, String(start), String(start + 7)],
  );
  return id;
}

export async function contributorSession(db: pg.Client, x: { id: string; handle: string }) {
  const { rows } = await db.query<{ id: string }>(
    "insert into users (x_user_id, x_handle) values ($1, $2) on conflict (x_user_id) do update set x_handle = excluded.x_handle returning id",
    [x.id, x.handle],
  );
  const token = await new SignJWT({
    sub: rows[0]!.id,
    kind: "contributor",
    xid: x.id,
    xh: x.handle,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("misthos")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
  return {
    userId: rows[0]!.id,
    cookie: {
      name: "misthos_contributor",
      value: token,
      url: E2E.baseURL,
      httpOnly: true,
      sameSite: "Lax" as const,
    },
  };
}

/** Add an X account to a program with a verified payout wallet, as joining would. */
export async function seedMember(
  db: pg.Client,
  p: { programId: string; userId: string; x: { id: string; handle: string }; wallet: string },
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into contributors (program_id, user_id, x_user_id, x_handle, wallet_address, wallet_verified_at)
     values ($1, $2, $3, $4, $5, now()) returning id`,
    [p.programId, p.userId, p.x.id, p.x.handle, p.wallet.toLowerCase()],
  );
  return rows[0]!.id;
}

export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

export async function newPage(ctx: BrowserContext) {
  const page = await ctx.newPage();
  return { page, errors: collectErrors(page) };
}
