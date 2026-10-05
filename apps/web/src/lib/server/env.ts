import "server-only";
import { z } from "zod";

const ServerEnv = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_CHAIN: z.enum(["arc-testnet", "arc-mainnet"]).default("arc-testnet"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  ARC_RPC_URL: z.string().optional(),
  X_CLIENT_ID: z.string().min(1),
  X_CLIENT_SECRET: z.string().min(1),
  /** GitHub OAuth app for verifying contributors' GitHub accounts (optional: GitHub work is refused without it). */
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  /** The worker's base URL (Railway). With the secret, new work wakes it at once instead of on its next tick. */
  WORKER_URL: z.url().optional(),
  /** Shared with the worker; authenticates wake calls. Not a signing key and can't move money. */
  WORKER_WAKE_SECRET: z.string().min(32).optional(),
});
export type ServerEnv = z.infer<typeof ServerEnv>;

let cached: ServerEnv | undefined;

/** Validated server env. Throws naming the missing keys, never their values. */
export function env(): ServerEnv {
  if (!cached) {
    const parsed = ServerEnv.safeParse(process.env);
    if (!parsed.success) {
      const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid server environment: ${keys}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function appOrigin(): string {
  return new URL(env().NEXT_PUBLIC_APP_URL).origin;
}
