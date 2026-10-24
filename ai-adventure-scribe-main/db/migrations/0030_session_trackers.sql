-- #1042: per-session story clocks. The engine stores each clock's live value
-- here (advanced by the DM's `tracker_changes`), so the tracker line and the
-- limit enforcement read server state instead of DM prose.
CREATE TABLE "session_trackers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"limit" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_trackers_session_id_name_unique" UNIQUE("session_id","name")
);
--> statement-breakpoint
ALTER TABLE "session_trackers" ADD CONSTRAINT "session_trackers_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_session_trackers_session_id" ON "session_trackers" USING btree ("session_id");