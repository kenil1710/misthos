import "server-only";
import { appOrigin } from "./env";

/** Short-lived httpOnly cookie carrying state + PKCE between /start and /callback. */
export const GITHUB_FLOW_COOKIE = "misthos_github_flow";
export const GITHUB_FLOW_TTL_SECONDS = 10 * 60;
/** Must match the OAuth app's registered callback exactly. */
export const githubRedirectUri = () => `${appOrigin()}/api/auth/github/callback`;
