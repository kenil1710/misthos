ALTER TABLE "contributors" ADD COLUMN "github_user_id" text;--> statement-breakpoint
ALTER TABLE "contributors" ADD COLUMN "github_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_login" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_github_user_id_unique" UNIQUE("github_user_id");