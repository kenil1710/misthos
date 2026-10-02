ALTER TABLE "contributors" ADD COLUMN "payee_wallet" text;--> statement-breakpoint
ALTER TABLE "contributors" ADD COLUMN "payee_tx_hash" text;--> statement-breakpoint
ALTER TABLE "contributors" ADD COLUMN "payee_registered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "executed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "payout_id" uuid;--> statement-breakpoint
CREATE INDEX "submissions_payout_idx" ON "submissions" USING btree ("payout_id");