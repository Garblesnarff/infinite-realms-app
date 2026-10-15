CREATE TABLE "character_concentration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"spell_name" text NOT NULL,
	"spell_id" text,
	"started_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "character_concentration_character_id_unique" UNIQUE("character_id")
);
--> statement-breakpoint
ALTER TABLE "character_concentration" ADD CONSTRAINT "character_concentration_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_character_concentration_character_id" ON "character_concentration" USING btree ("character_id");