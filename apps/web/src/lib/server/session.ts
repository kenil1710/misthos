import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";
import { env } from "./env";

/**
 * Two independent sessions so one person can act as owner (wallet) and contributor (X) in the same browser.
 * Each is a short HS256 JWT in an httpOnly, SameSite=Lax cookie.
 */
export const SESSION_COOKIES = {
  owner: "misthos_owner",
  contributor: "misthos_contributor",
} as const;
export type SessionKind = keyof typeof SESSION_COOKIES;

const MAX_AGE_SECONDS = 7 * 24 * 3600;

const OwnerClaims = z.object({ sub: z.uuid(), kind: z.literal("owner"), addr: z.string() });
const ContributorClaims = z.object({
  sub: z.uuid(),
  kind: z.literal("contributor"),
  xid: z.string(),
  xh: z.string(),
});
export type OwnerSession = z.infer<typeof OwnerClaims>;
export type ContributorSession = z.infer<typeof ContributorClaims>;

const key = () => new TextEncoder().encode(env().SESSION_SECRET);

export async function signToken(
  claims: Record<string, unknown>,
  maxAgeSeconds: number,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("misthos")
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(key());
}

export async function verifyToken(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "misthos", algorithms: ["HS256"] });
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/**
 * A non-secret hint for static pages (the landing page is cached, so it can't read the httpOnly sessions):
 * which sessions exist, the owner's short address and the contributor's handle. It grants nothing; every page
 * and API still checks the real session.
 */
export const HINT_COOKIE = "misthos_hint";
type Hint = { o?: string; c?: string };

async function writeHint(update: (h: Hint) => Hint) {
  const jar = await cookies();
  let h: Hint = {};
  try {
    h = JSON.parse(decodeURIComponent(jar.get(HINT_COOKIE)?.value ?? "")) as Hint;
  } catch {}
  const next = update(h);
  if (!next.o && !next.c) jar.delete(HINT_COOKIE);
  else
    jar.set(HINT_COOKIE, encodeURIComponent(JSON.stringify(next)), {
      ...cookieOptions(MAX_AGE_SECONDS),
      httpOnly: false,
    });
}

export async function startSession(claims: OwnerSession | ContributorSession): Promise<void> {
  const token = await signToken(claims, MAX_AGE_SECONDS);
  (await cookies()).set(SESSION_COOKIES[claims.kind], token, cookieOptions(MAX_AGE_SECONDS));
  await writeHint((h) =>
    claims.kind === "owner"
      ? { ...h, o: `${claims.addr.slice(0, 6)}…${claims.addr.slice(-4)}` }
      : { ...h, c: claims.xh },
  );
}

export async function endSession(kind: SessionKind): Promise<void> {
  (await cookies()).delete(SESSION_COOKIES[kind]);
  await writeHint((h) => (kind === "owner" ? { ...h, o: undefined } : { ...h, c: undefined }));
}

async function read(kind: SessionKind) {
  const token = (await cookies()).get(SESSION_COOKIES[kind])?.value;
  return token ? verifyToken(token) : null;
}

export async function getOwnerSession(): Promise<OwnerSession | null> {
  const parsed = OwnerClaims.safeParse(await read("owner"));
  return parsed.success ? parsed.data : null;
}

export async function getContributorSession(): Promise<ContributorSession | null> {
  const parsed = ContributorClaims.safeParse(await read("contributor"));
  return parsed.success ? parsed.data : null;
}
