CREATE TABLE "story_map_progress" (
	"campaign_id" uuid NOT NULL,
	"place_key" text NOT NULL,
	"state" text NOT NULL,
	"first_session_id" uuid,
	"visited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_map_progress_state_check" CHECK ("story_map_progress"."state" in ('known', 'visited'))
);
--> statement-breakpoint
CREATE TABLE "story_map_revealed_edges" (
	"campaign_id" uuid NOT NULL,
	"from_key" text NOT NULL,
	"to_key" text NOT NULL,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_map_progress" ADD CONSTRAINT "story_map_progress_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_progress" ADD CONSTRAINT "story_map_progress_first_session_id_game_sessions_id_fk" FOREIGN KEY ("first_session_id") REFERENCES "public"."game_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_revealed_edges" ADD CONSTRAINT "story_map_revealed_edges_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_revealed_edges" ADD CONSTRAINT "story_map_revealed_edges_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_map_progress_campaign_place_key" ON "story_map_progress" USING btree ("campaign_id","place_key");--> statement-breakpoint
CREATE UNIQUE INDEX "story_map_revealed_edges_campaign_from_to" ON "story_map_revealed_edges" USING btree ("campaign_id","from_key","to_key");--> statement-breakpoint
-- Player rows: the server writes them with a privileged role and filters by campaigns.user_id
-- (RLS is off for the app). The public API roles get nothing, as in 0038 and #1784.
ALTER TABLE "story_map_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "story_map_revealed_edges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "story_map_progress" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON "story_map_revealed_edges" FROM anon, authenticated;
