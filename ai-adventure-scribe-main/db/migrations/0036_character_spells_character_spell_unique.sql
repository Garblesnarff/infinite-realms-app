CREATE UNIQUE INDEX "idx_character_spells_character_spell_unique" ON "character_spells" USING btree ("character_id","spell_id");
