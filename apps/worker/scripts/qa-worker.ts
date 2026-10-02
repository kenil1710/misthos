/**
 * QA worker: the real worker (Circle agent, Claude judge, Postgres queue, Arc) with one difference: links reserved for
 * QA are served from <repo>/.qa/fixtures.json instead of the network, so the live QA run can script posts by fictional
 * contributors. Every other link (e.g. real GitHub pull requests) is fetched for real. Testnet only.
 *
 *   pnpm --filter @misthos/worker exec tsx --env-file=../../.env scripts/qa-worker.ts
 */
import type { Fetchers, FetchResult, Resource } from "@misthos/agent";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { startWorker } from "../src/start";

if ((process.env.NEXT_PUBLIC_CHAIN ?? "arc-testnet") !== "arc-testnet") {
  console.error("qa-worker runs on arc-testnet only.");
  process.exit(1);
}

const FILE = path.resolve(import.meta.dirname, "../../../.qa/fixtures.json");

/** Fixture timestamps may be relative ("now-<seconds>"), resolved at fetch time like a freshly published post. */
type Fixture = Omit<Resource, "timestamp"> & { timestamp: string | null; deleted?: boolean };

function fixture(id: string): FetchResult | null {
  if (!existsSync(FILE)) return null;
  const all = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Fixture>;
  const f = all[id];
  if (!f) return null;
  if (f.deleted) return { outcome: { status: "not_found", detail: "The post was deleted." }, usage: [] };
  const m = /^now-(\d+)$/.exec(f.timestamp ?? "");
  const timestamp = m ? new Date(Date.now() - Number(m[1]) * 1000).toISOString() : f.timestamp;
  return { outcome: { status: "ok", resource: { ...f, timestamp } as Resource }, usage: [] };
}

void startWorker({
  name: "misthos-qa-worker",
  wrapFetchers: (real): Fetchers => ({
    x: async (id) => fixture(`x:${id}`) ?? real.x(id),
    article: async (id) => fixture(`article:${id}`) ?? real.article(id),
    githubPr: (id) => real.githubPr(id),
    githubCommit: (id) => real.githubCommit(id),
  }),
}).catch((e) => {
  console.error("qa worker failed:", (e as Error).message);
  process.exit(1);
});
