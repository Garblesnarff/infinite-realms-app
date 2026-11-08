CREATE TABLE "dm_reply_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"state" text NOT NULL,
	"text" text NOT NULL,
	"envelope" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dm_reply_records" ADD CONSTRAINT "dm_reply_records_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dm_reply_records_session_id" ON "dm_reply_records" USING btree ("session_id");