CREATE TABLE "story_map_edges" (
	"campaign_id" text NOT NULL,
	"from_key" text NOT NULL,
	"to_key" text NOT NULL,
	"label" text,
	"hidden" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_map_places" (
	"campaign_id" text NOT NULL,
	"place_key" text NOT NULL,
	"name" text NOT NULL,
	"zone_key" text,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"fight_env" text NOT NULL,
	"fight_size" text NOT NULL,
	"fight_seed" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_map_places_fight_size_check" CHECK ("story_map_places"."fight_size" in ('small', 'medium', 'large'))
);
--> statement-breakpoint
ALTER TABLE "story_map_edges" ADD CONSTRAINT "story_map_edges_campaign_id_starter_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."starter_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_map_places" ADD CONSTRAINT "story_map_places_campaign_id_starter_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."starter_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_map_edges_campaign_from_to" ON "story_map_edges" USING btree ("campaign_id","from_key","to_key");--> statement-breakpoint
CREATE INDEX "idx_story_map_edges_campaign_id" ON "story_map_edges" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_map_places_campaign_place_key" ON "story_map_places" USING btree ("campaign_id","place_key");--> statement-breakpoint
-- The server and the ingest tool write these with privileged roles; the public API roles get
-- nothing, the same lockdown as the feedback table (0017) and #1784.
ALTER TABLE "story_map_places" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "story_map_edges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "story_map_places" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON "story_map_edges" FROM anon, authenticated;
