ALTER TABLE "payouts" ADD COLUMN "round_id_bytes32" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "replan_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "lock_owner" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "lock_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "rechecked_at" timestamp with time zone;--> statement-breakpoint
-- Live payouts belong to their round's current on-chain id.
UPDATE "payouts" p SET "round_id_bytes32" = r."round_id_bytes32" FROM "rounds" r WHERE r."id" = p."round_id" AND p."status" <> 'failed';--> statement-breakpoint
-- Count re-plans already made, so the next one never reuses a cancelled on-chain id.
UPDATE "rounds" r SET "replan_count" = c.n FROM (SELECT "entity_id", count(*)::int AS n FROM "audit_events" WHERE "action" = 'round.replanned' GROUP BY "entity_id") c WHERE c."entity_id" = r."id"::text;
