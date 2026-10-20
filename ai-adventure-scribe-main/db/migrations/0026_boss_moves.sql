CREATE TABLE "combat_boss_state" (
	"encounter_id" uuid PRIMARY KEY NOT NULL,
	"moves_used" text[] DEFAULT '{}' NOT NULL,
	"last_fired_round" integer,
	"finale_telegraph" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hero_turns_ended" integer DEFAULT 0 NOT NULL,
	"defy_left" integer DEFAULT 0 NOT NULL,
	"defy_armed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "combat_participants" ADD COLUMN "is_mook" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "combat_participants" ADD COLUMN "boss_moves" jsonb;--> statement-breakpoint
ALTER TABLE "combat_boss_state" ADD CONSTRAINT "combat_boss_state_encounter_id_combat_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."combat_encounters"("id") ON DELETE cascade ON UPDATE no action;