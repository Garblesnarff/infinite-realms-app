-- #1011: character_spells rows whose character was deleted before this FK
-- existed would make the ALTER below fail (Hetzner's #957 apply found 3 on
-- prod). Delete the orphans first; the FK then keeps the table clean.
DELETE FROM "character_spells" WHERE "character_id" NOT IN (SELECT "id" FROM "characters");--> statement-breakpoint
ALTER TABLE "character_spells" ADD CONSTRAINT "character_spells_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
