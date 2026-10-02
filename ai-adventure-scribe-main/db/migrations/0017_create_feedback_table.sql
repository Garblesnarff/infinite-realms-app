-- Additive: creates the feedback table behind POST /v1/feedback (Send feedback modal).
-- MANUAL APPLY AFTER MERGE: Hetzner applies this only on Rob's typed line, and the apply is
-- recorded (#1703). Until it is applied, POST /v1/feedback logs ANALYTICS_FEEDBACK and returns 503.
-- No existing table or column is touched.
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"page" text NOT NULL,
	"build" text,
	"campaign_slug" text,
	"session_id" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_feedback_created_at" ON "feedback" USING btree ("created_at");
--> statement-breakpoint
-- Written only by the server (service role). No anon/authenticated access.
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "feedback" FROM anon, authenticated;
