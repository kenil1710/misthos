CREATE INDEX "contributors_x_user_idx" ON "contributors" USING btree ("x_user_id");--> statement-breakpoint
CREATE INDEX "payouts_contributor_idx" ON "payouts" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "program_members_user_idx" ON "program_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "submissions_contributor_created_idx" ON "submissions" USING btree ("contributor_id","created_at");