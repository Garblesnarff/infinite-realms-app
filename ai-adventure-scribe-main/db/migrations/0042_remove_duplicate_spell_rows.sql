-- #1803: remove the two retired duplicate spell rows and their class_spells links.
-- Canonical ids stay: Hideous Laughter 49679c17-4b59-5e1b-b9a2-8ed2f53f209e (Bard + Wizard) and Floating
-- Disk 14bccb17-1728-5095-ab6a-35b28812c6b7 (Wizard). Retired: Tasha's Hideous Laughter 2f531b61-5626-5b7b-a9f9-bf935e580864
-- (Bard) and Tenser's Floating Disk ce62cea7-640b-5439-a175-10289409f59b (Wizard).
--
-- Prod data: before the deletes, any character_spells row on a retired id is
-- repointed to the canonical id. A row whose character already holds the
-- canonical spell is left alone by the UPDATE and deleted by the next
-- statement instead (the (character_id, spell_id) unique index forbids two
-- rows for one character + spell), so no player's spell is lost and no row is
-- left pointing at a deleted id. No pre-apply count check is needed: the
-- repoint handles a stray row instead of relying on the ON DELETE CASCADE
-- precondition (verified 0 on 11-27, comment 7209639615).
-- This PR only writes the migration. It is NOT applied here.
UPDATE "character_spells" SET "spell_id" = '49679c17-4b59-5e1b-b9a2-8ed2f53f209e' WHERE "spell_id" = '2f531b61-5626-5b7b-a9f9-bf935e580864' AND NOT EXISTS (SELECT 1 FROM "character_spells" AS "existing" WHERE "existing"."character_id" = "character_spells"."character_id" AND "existing"."spell_id" = '49679c17-4b59-5e1b-b9a2-8ed2f53f209e');
--> statement-breakpoint
DELETE FROM "character_spells" WHERE "spell_id" = '2f531b61-5626-5b7b-a9f9-bf935e580864';
--> statement-breakpoint
UPDATE "character_spells" SET "spell_id" = '14bccb17-1728-5095-ab6a-35b28812c6b7' WHERE "spell_id" = 'ce62cea7-640b-5439-a175-10289409f59b' AND NOT EXISTS (SELECT 1 FROM "character_spells" AS "existing" WHERE "existing"."character_id" = "character_spells"."character_id" AND "existing"."spell_id" = '14bccb17-1728-5095-ab6a-35b28812c6b7');
--> statement-breakpoint
DELETE FROM "character_spells" WHERE "spell_id" = 'ce62cea7-640b-5439-a175-10289409f59b';
--> statement-breakpoint
DELETE FROM "class_spells" WHERE "spell_id" IN ('2f531b61-5626-5b7b-a9f9-bf935e580864', 'ce62cea7-640b-5439-a175-10289409f59b');
--> statement-breakpoint
DELETE FROM "spells" WHERE "id" IN ('2f531b61-5626-5b7b-a9f9-bf935e580864', 'ce62cea7-640b-5439-a175-10289409f59b');
--> statement-breakpoint
