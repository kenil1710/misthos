/**
 * Check that the app's hot read paths use indexes. Builds an in-memory Postgres (PGlite) with every checked-in
 * migration, fills it with a realistic volume (200 programs, 4,000 contributors, 40,000 submissions), runs ANALYZE,
 * then prints EXPLAIN for each query. Exits 1 if any of them falls back to a sequential scan on a large table.
 *
 *   pnpm --filter @misthos/web exec tsx scripts/explain.mts
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const db = await PGlite.create({ extensions: { pg_trgm } });
await migrate(drizzle(db), { migrationsFolder: path.join(root, "packages/db/migrations") });

const rubric = JSON.stringify({ categories: [] });
const limits = JSON.stringify({ maxPerRound: "1000000", payeeCooldownSeconds: 86400 });
await db.exec(`
  insert into users (id, wallet_address, x_user_id, x_handle)
    select gen_random_uuid(), '0x' || lpad(to_hex(g), 40, '0'), 'x' || g, 'h' || g from generate_series(1, 4200) g;
  insert into programs (slug, name, description, owner_user_id, chain, rubric_json, rate_per_point, limits_json,
      auto_approve_confidence, round_length_days, first_round_starts_at, status)
    select 'p' || g, 'P' || g, 'd', (select id from users where x_user_id = 'x' || g), 'arc-testnet',
      '${rubric}', 100000, '${limits}', 0.8, 7, now(), 'active' from generate_series(1, 200) g;
  insert into program_members (program_id, user_id, role)
    select id, owner_user_id, 'owner' from programs;
  -- Reviewers, so membership lookups run at a realistic size.
  insert into program_members (program_id, user_id, role)
    select p.id, u.id, 'reviewer' from programs p
    join (select id, row_number() over () r from users) u on u.r % 200 = 0 or u.r > 200 and u.r % 7 = 0
    on conflict do nothing;
  insert into rounds (program_id, number, starts_at, ends_at)
    select p.id, n, now() - (n || ' days')::interval, now() + interval '7 days' from programs p, generate_series(1, 5) n;
  insert into contributors (program_id, user_id, x_user_id, x_handle, wallet_address)
    select p.id, u.id, u.x_user_id, u.x_handle, u.wallet_address
    from (select id, row_number() over () r from programs) p
    join (select id, x_user_id, x_handle, wallet_address, row_number() over () r from users) u
      on u.r % 200 = p.r % 200 and u.r > 200;
  insert into submissions (program_id, round_id, contributor_id, url, source_type, resource_id, status)
    select c.program_id, (select id from rounds r where r.program_id = c.program_id and r.number = 1),
      c.id, 'https://x.com/i/web/status/' || g || c.id, 'x_post', g || '-' || c.id,
      (array['approved','rejected','escalated','pending','paid'])[1 + g % 5]::submission_status
    from contributors c, generate_series(1, 10) g;
  insert into decisions (submission_id, flags_json, action, decision_json, decision_hash, signature, signer_address,
      rule_version, decided_by, summary)
    select id, '[]', 'approve', '{}', md5(id::text), '0x', '0x', 'v1', 'agent', 's' from submissions;
  insert into payouts (round_id, contributor_id, payout_id_bytes32, to_address, amount, decision_hash, status)
    select (select id from rounds r where r.program_id = c.program_id and r.number = 1), c.id, md5(c.id::text), '0x',
      1000, md5(c.id::text), 'executed' from contributors c;
  analyze;
`);

const one = async (sql: string) => (await db.query<Record<string, string>>(sql)).rows[0]!;
const contributor = await one("select id, x_user_id, program_id from contributors limit 1");
const owner = await one("select owner_user_id as id from programs limit 1");
const program = await one("select id, slug from programs limit 1");

const QUERIES: [string, string][] = [
  ["Programs a person owns (sidebar, home)", `select * from program_members pm join programs p on p.id = pm.program_id where pm.user_id = '${owner.id}'`],
  ["Programs you joined", `select * from contributors c join programs p on p.id = c.program_id where c.x_user_id = '${contributor.x_user_id}'`],
  ["Contributor membership", `select * from contributors where program_id = '${contributor.program_id}' and x_user_id = '${contributor.x_user_id}'`],
  ["A contributor's submissions (page + poll)", `select * from submissions where contributor_id = '${contributor.id}' order by created_at desc limit 100`],
  ["Latest decisions for those submissions", `select * from decisions where submission_id in (select id from submissions where contributor_id = '${contributor.id}')`],
  ["A contributor's earnings", `select sum(amount) from payouts where contributor_id = '${contributor.id}' and status = 'executed'`],
  ["Review queue by status", `select * from submissions where program_id = '${program.id}' and status = 'escalated' order by created_at desc`],
  ["Counts by status per program", `select status, count(*) from submissions where program_id = '${program.id}' group by status`],
  ["Rounds of a program", `select * from rounds where program_id = '${program.id}' order by number`],
  ["Program by slug (join, audit)", `select * from programs where slug = '${program.slug}'`],
  ["Audit log page", `select * from audit_events where program_id = '${program.id}' order by created_at desc limit 50`],
];

const out: string[] = [];
let bad = 0;
for (const [name, sql] of QUERIES) {
  const plan = (await db.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).rows
    .map((r) => r["QUERY PLAN"])
    .join("\n");
  const seq = /Seq Scan on (submissions|contributors|decisions|payouts|program_members)\b/.test(plan);
  if (seq) bad++;
  out.push(`## ${name} ${seq ? "SEQ SCAN" : "ok"}\n${plan}\n`);
  console.log(`${seq ? "SEQ " : "ok  "} ${name}`);
}
mkdirSync(path.join(root, "docs/test-results"), { recursive: true });
writeFileSync(path.join(root, "docs/test-results/explain.txt"), out.join("\n"));
await db.close();
process.exit(bad ? 1 : 0);
