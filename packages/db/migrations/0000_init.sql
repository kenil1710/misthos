CREATE TYPE "public"."contributor_status" AS ENUM('active', 'suspended', 'removed');--> statement-breakpoint
CREATE TYPE "public"."decided_by" AS ENUM('agent', 'human');--> statement-breakpoint
CREATE TYPE "public"."decision_action" AS ENUM('approve', 'partial', 'reject', 'escalate');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'reviewer');--> statement-breakpoint
CREATE TYPE "public"."nonce_purpose" AS ENUM('siwe', 'wallet_link');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'proposed', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."program_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('open', 'closed', 'proposed', 'approved', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('x_post', 'github_pr', 'article');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'processing', 'approved', 'partial', 'rejected', 'escalated', 'paid');--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"est_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"data_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"purpose" "nonce_purpose" NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"x_user_id" text NOT NULL,
	"x_handle" text NOT NULL,
	"github_login" text,
	"wallet_address" text,
	"wallet_verified_at" timestamp with time zone,
	"wallet_changed_at" timestamp with time zone,
	"wallet_proof_message" text,
	"wallet_proof_signature" text,
	"trust_tier" integer DEFAULT 0 NOT NULL,
	"status" "contributor_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"flags_json" jsonb NOT NULL,
	"llm_output_json" jsonb,
	"action" "decision_action" NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"decision_json" text NOT NULL,
	"decision_hash" text NOT NULL,
	"signature" text NOT NULL,
	"signer_address" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"rule_version" text NOT NULL,
	"decided_by" "decided_by" NOT NULL,
	"decided_by_user_id" uuid,
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_decision_hash_unique" UNIQUE("decision_hash")
);
--> statement-breakpoint
CREATE TABLE "fetched_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "source_type" NOT NULL,
	"resource_id" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"content_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"simhash" bigint,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"payout_id_bytes32" text NOT NULL,
	"to_address" text NOT NULL,
	"amount" bigint NOT NULL,
	"decision_hash" text NOT NULL,
	"decision_root" text,
	"tx_hash" text,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_payout_id_bytes32_unique" UNIQUE("payout_id_bytes32")
);
--> statement-breakpoint
CREATE TABLE "program_members" (
	"program_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_members_program_id_user_id_pk" PRIMARY KEY("program_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"logo_url" text,
	"owner_user_id" uuid NOT NULL,
	"program_id_bytes32" text,
	"vault_address" text,
	"chain" text NOT NULL,
	"rubric_json" jsonb NOT NULL,
	"rate_per_point" bigint NOT NULL,
	"limits_json" jsonb NOT NULL,
	"auto_approve_confidence" real NOT NULL,
	"min_account_age_days" integer DEFAULT 0 NOT NULL,
	"round_length_days" integer NOT NULL,
	"first_round_starts_at" timestamp with time zone NOT NULL,
	"status" "program_status" DEFAULT 'draft' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "round_status" DEFAULT 'open' NOT NULL,
	"round_id_bytes32" text,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"decision_root" text,
	"tx_hash_propose" text,
	"tx_hash_approve" text,
	"tx_hash_execute" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"url" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"resource_id" text NOT NULL,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"amount" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text,
	"x_user_id" text,
	"x_handle" text,
	"x_created_at" timestamp with time zone,
	"name" text,
	"email" text,
	"is_founder" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address"),
	CONSTRAINT "users_x_user_id_unique" UNIQUE("x_user_id")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_nonces" ADD CONSTRAINT "auth_nonces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_members" ADD CONSTRAINT "program_members_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_members" ADD CONSTRAINT "program_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_usage_provider_created_idx" ON "api_usage" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_program_created_idx" ON "audit_events" USING btree ("program_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_nonces_expires_idx" ON "auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_program_x_uq" ON "contributors" USING btree ("program_id","x_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_program_wallet_uq" ON "contributors" USING btree ("program_id","wallet_address");--> statement-breakpoint
CREATE INDEX "contributors_user_idx" ON "contributors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "decisions_submission_idx" ON "decisions" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fetched_resources_source_uq" ON "fetched_resources" USING btree ("source_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_round_contributor_uq" ON "payouts" USING btree ("round_id","contributor_id");--> statement-breakpoint
CREATE INDEX "programs_owner_idx" ON "programs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_program_number_uq" ON "rounds" USING btree ("program_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_contributor_resource_uq" ON "submissions" USING btree ("contributor_id","source_type","resource_id");--> statement-breakpoint
CREATE INDEX "submissions_program_resource_idx" ON "submissions" USING btree ("program_id","source_type","resource_id");--> statement-breakpoint
CREATE INDEX "submissions_program_status_idx" ON "submissions" USING btree ("program_id","status");--> statement-breakpoint
CREATE INDEX "submissions_round_idx" ON "submissions" USING btree ("round_id");