import "server-only";
import { appOrigin } from "./env";

/** Short-lived httpOnly cookie carrying PKCE state between /start and /callback. */
export const X_FLOW_COOKIE = "misthos_x_flow";
export const X_FLOW_TTL_SECONDS = 10 * 60;

export const xRedirectUri = () => `${appOrigin()}/api/auth/x/callback`;
