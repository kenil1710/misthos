ALTER TYPE "public"."source_type" ADD VALUE 'github_commit' BEFORE 'article';--> statement-breakpoint
DROP INDEX "submissions_contributor_resource_uq";--> statement-breakpoint
ALTER TABLE "api_usage" ADD COLUMN "program_id" uuid;--> statement-breakpoint
ALTER TABLE "api_usage" ADD COLUMN "meta_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "category_key" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "points" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "summary" text NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_contributor_resource_live_uq" ON "submissions" USING btree ("contributor_id","source_type","resource_id") WHERE status <> 'rejected';