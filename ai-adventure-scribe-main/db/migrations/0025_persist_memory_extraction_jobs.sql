CREATE TABLE "memory_extraction_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"session_id" uuid NOT NULL,
	"campaign_id" uuid,
	"character_id" text,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"payload_hash" text NOT NULL,
	"max_tokens" integer NOT NULL,
	"turn" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"charged" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "idx_memory_extraction_jobs_status" ON "memory_extraction_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_memory_extraction_jobs_session" ON "memory_extraction_jobs" USING btree ("session_id");