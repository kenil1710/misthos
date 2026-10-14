ALTER TABLE "programs" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "waiting_for_funds_at" timestamp with time zone;