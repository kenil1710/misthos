import "server-only";
import { cached } from "./cache";
import {
  getPublicProgram,
  publicDecisions,
  publicPayouts,
  publicRounds,
  publicStats,
} from "./public";

/**
 * Public audit data is the same for every visitor, so it's cached briefly (15s): pages stay fast under load and a
 * new decision still shows within seconds. Verifying a decision always reads fresh from the API.
 */
const opts = { revalidate: 15, tags: ["public"] };
/** Bump when a cached query's logic changes, so a deploy never serves the old shape from the shared cache. */
const V = "v2";
export const getPublicProgramCached = cached(getPublicProgram, ["public-program", V], opts);
export const publicStatsCached = cached((id: string) => publicStats(id), ["public-stats", V], opts);
export const publicRoundsCached = cached(publicRounds, ["public-rounds", V], opts);
export const publicPayoutsCached = cached(publicPayouts, ["public-payouts", V], opts);
export const publicDecisionsCached = cached(publicDecisions, ["public-decisions", V], opts);
