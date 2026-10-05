/**
 * Re-process decided submissions with the current agent: fresh fetch, current rules, and a new signed decision that
 * supersedes the latest one (both audited). Refuses anything already in a payout or paid.
 *
 *   pnpm --filter @misthos/worker reprocess <submission id | X post URL> [...] --reason "why"
 */
import { processSubmission } from "@misthos/agent";
import { submissions } from "@misthos/db";
import { classifySubmissionUrl } from "@misthos/shared";
import { and, eq } from "drizzle-orm";
import { buildDeps } from "../src/start";

const args = process.argv.slice(2);
const r = args.indexOf("--reason");
const reason = r >= 0 ? args[r + 1]?.trim() : "";
const targets = args.filter((a, i) => i !== r && i !== r + 1);
if (!targets.length || !reason || reason.length < 10) {
  console.error('Usage: reprocess <submission id | URL> [...] --reason "at least 10 characters"');
  process.exit(2);
}

const { deps, pool } = buildDeps({ poolMax: 2 });
let failed = false;
for (const target of targets) {
  let ids = [target];
  if (!/^[0-9a-f-]{36}$/i.test(target)) {
    const parsed = classifySubmissionUrl(target);
    if (!parsed.ok) {
      console.error(`${target}: not a submission id or a supported URL`);
      failed = true;
      continue;
    }
    const rows = await deps.db
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          eq(submissions.sourceType, parsed.sourceType),
          eq(submissions.resourceId, parsed.resourceId),
        ),
      );
    ids = rows.map((x) => x.id);
    if (!ids.length) console.error(`${target}: no submission found`);
  }
  for (const id of ids) {
    const res = await processSubmission(deps, id, { reprocess: { reason, actor: "system" } });
    console.log(JSON.stringify({ submissionId: id, ...res }, null, 2));
    if (res.status !== "decided") failed = true;
  }
}
await pool.end();
process.exit(failed ? 1 : 0);
