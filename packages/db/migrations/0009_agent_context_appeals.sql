CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"note" text NOT NULL,
	"decision_hash" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeals_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "program_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"program_id" uuid,
	"version" integer,
	"about" text NOT NULL,
	"links_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"must_include_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'reading' NOT NULL,
	"understanding_json" jsonb,
	"sources_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context_hash" text,
	"input_hash" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "min_x_followers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "max_submissions_per_round" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "context_version" integer;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_contexts" ADD CONSTRAINT "program_contexts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_contexts" ADD CONSTRAINT "program_contexts_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appeals_program_open_idx" ON "appeals" USING btree ("program_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "program_contexts_program_version_uq" ON "program_contexts" USING btree ("program_id","version") WHERE "program_contexts"."version" is not null;--> statement-breakpoint
CREATE INDEX "program_contexts_input_idx" ON "program_contexts" USING btree ("input_hash");