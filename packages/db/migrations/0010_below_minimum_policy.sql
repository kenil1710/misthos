CREATE TYPE "public"."below_minimum_policy" AS ENUM('review', 'reject', 'block');--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "below_minimum" "below_minimum_policy" DEFAULT 'review' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "x_followers" integer;